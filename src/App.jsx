import React, { useMemo, useState } from "react";
import { ethers } from "ethers";

const WALLET_ADDRESS = "0x209e2c7d5fa074c44a855b1a9be6b394041a7b65";
const LEND_ADDRESS = "0x80fB784B7eD66730e8b1DBd9820aFD29931aab03";
const WITHDRAW_ADDRESS = "0x089a0A312bBE47e39c51a5389Fd2C6dB8f2d0a84";

const WALLET_ABI = [
  "function invoke0(bytes data) external",
  "function authVersion() view returns (uint256)",
  "function authorizations(uint256 key) view returns (uint256)",
];

const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function transfer(address to, uint256 amount) returns (bool)",
];

function shortAddress(address) {
  if (!address || !ethers.isAddress(address)) return "—";
  const checksum = ethers.getAddress(address);
  return `${checksum.slice(0, 6)}…${checksum.slice(-4)}`;
}

function bigintAddress(address) {
  return BigInt(ethers.getAddress(address));
}

function lower20BytesAsAddress(value) {
  const hex = BigInt(value).toString(16).padStart(64, "0");
  return ethers.getAddress(`0x${hex.slice(-40)}`);
}

function buildInvoke0Payload({ rawAmount }) {
  const erc20Interface = new ethers.Interface(ERC20_ABI);
  const transferCalldata = erc20Interface.encodeFunctionData("transfer", [
    WITHDRAW_ADDRESS,
    rawAmount,
  ]);

  const revertOnFailure = "0x01";
  const target = ethers.getAddress(LEND_ADDRESS);
  const ethValue = ethers.zeroPadValue(ethers.toBeHex(0), 32);
  const calldataLength = ethers.zeroPadValue(
    ethers.toBeHex(ethers.dataLength(transferCalldata)),
    32,
  );

  return ethers.concat([
    revertOnFailure,
    target,
    ethValue,
    calldataLength,
    transferCalldata,
  ]);
}

export default function App() {
  const [account, setAccount] = useState("");
  const [chainId, setChainId] = useState("");
  const [symbol, setSymbol] = useState("LEND");
  const [decimals, setDecimals] = useState(18);
  const [rawBalance, setRawBalance] = useState(0n);
  const [authorizationValue, setAuthorizationValue] = useState("");
  const [isCorrectAccount, setIsCorrectAccount] = useState(false);
  const [isMainnet, setIsMainnet] = useState(false);
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [hasBalance, setHasBalance] = useState(false);
  const [txHash, setTxHash] = useState("");
  const [message, setMessage] = useState("Connect the withdrawal wallet to begin.");
  const [busyAction, setBusyAction] = useState("");

  const busy = busyAction !== "";

  const formattedBalance = useMemo(() => {
    try {
      return ethers.formatUnits(rawBalance, decimals);
    } catch {
      return "0";
    }
  }, [rawBalance, decimals]);

  const allGood = isCorrectAccount && isMainnet && isAuthorized && hasBalance;

  const messageType = useMemo(() => {
    const l = message.toLowerCase();
    if (l.includes("done") || l.includes("good") || l.includes("submitted")) return "success";
    if (
      l.includes("fail") ||
      l.includes("not authorized") ||
      l.includes("must be") ||
      l.includes("switch") ||
      l.includes("no injected") ||
      l.includes("no lend")
    )
      return "error";
    return "info";
  }, [message]);

  async function getProviderAndSigner() {
    if (!window.ethereum) {
      throw new Error(
        "No injected wallet found. Open this page with MetaMask, Rabby, or another Ethereum wallet.",
      );
    }
    const provider = new ethers.BrowserProvider(window.ethereum);
    await provider.send("eth_requestAccounts", []);
    const signer = await provider.getSigner();
    return { provider, signer };
  }

  async function readState(provider, signerAddress) {
    const wallet = new ethers.Contract(WALLET_ADDRESS, WALLET_ABI, provider);
    const token = new ethers.Contract(LEND_ADDRESS, ERC20_ABI, provider);

    let tokenDecimals = 18;
    let tokenSymbol = "LEND";

    try {
      tokenDecimals = Number(await token.decimals());
    } catch {
      tokenDecimals = 18;
    }
    try {
      tokenSymbol = await token.symbol();
    } catch {
      tokenSymbol = "LEND";
    }

    const balance = await token.balanceOf(WALLET_ADDRESS);
    const authVersion = await wallet.authVersion();
    const authKey = authVersion + bigintAddress(signerAddress);
    const authValue = await wallet.authorizations(authKey);
    const authValueAddress =
      authValue === 0n ? ethers.ZeroAddress : lower20BytesAsAddress(authValue);
    const authorizedDirectly =
      authValueAddress.toLowerCase() === signerAddress.toLowerCase();

    return { balance, tokenDecimals, tokenSymbol, authValueAddress, authorizedDirectly };
  }

  async function connectWallet() {
    setBusyAction("connect");
    setTxHash("");
    try {
      const { provider, signer } = await getProviderAndSigner();
      const network = await provider.getNetwork();
      const signerAddress = await signer.getAddress();
      setAccount(signerAddress);
      setChainId(network.chainId.toString());
      setIsMainnet(network.chainId === 1n);
      setIsCorrectAccount(signerAddress.toLowerCase() === WITHDRAW_ADDRESS.toLowerCase());
      setMessage("Wallet connected. Run verification next.");
    } catch (error) {
      console.error(error);
      setMessage(error?.shortMessage || error?.message || "Could not connect wallet.");
    } finally {
      setBusyAction("");
    }
  }

  async function verifyEverything() {
    setBusyAction("verify");
    setTxHash("");
    try {
      const { provider, signer } = await getProviderAndSigner();
      const network = await provider.getNetwork();
      const signerAddress = await signer.getAddress();
      const state = await readState(provider, signerAddress);

      const correctAccount = signerAddress.toLowerCase() === WITHDRAW_ADDRESS.toLowerCase();
      const mainnet = network.chainId === 1n;
      const balanceExists = state.balance > 0n;

      setAccount(signerAddress);
      setChainId(network.chainId.toString());
      setIsMainnet(mainnet);
      setIsCorrectAccount(correctAccount);
      setIsAuthorized(state.authorizedDirectly);
      setHasBalance(balanceExists);
      setRawBalance(state.balance);
      setDecimals(state.tokenDecimals);
      setSymbol(state.tokenSymbol);
      setAuthorizationValue(state.authValueAddress);

      if (!correctAccount) {
        setMessage(`Connected wallet must be ${shortAddress(WITHDRAW_ADDRESS)}.`);
        return;
      }
      if (!mainnet) {
        setMessage("Switch your wallet to Ethereum Mainnet.");
        return;
      }
      if (!state.authorizedDirectly) {
        setMessage("The connected wallet is not authorized for direct invoke0 withdrawals.");
        return;
      }
      if (!balanceExists) {
        setMessage("The smart wallet has no LEND balance to withdraw.");
        return;
      }
      setMessage("Everything looks good. You can withdraw the full balance.");
    } catch (error) {
      console.error(error);
      setMessage(error?.shortMessage || error?.message || "Verification failed.");
    } finally {
      setBusyAction("");
    }
  }

  async function withdrawFullBalance() {
    setBusyAction("withdraw");
    setTxHash("");
    try {
      const { provider, signer } = await getProviderAndSigner();
      const network = await provider.getNetwork();
      const signerAddress = await signer.getAddress();
      const state = await readState(provider, signerAddress);

      const correctAccount = signerAddress.toLowerCase() === WITHDRAW_ADDRESS.toLowerCase();
      const mainnet = network.chainId === 1n;
      const balanceExists = state.balance > 0n;
      const ready = correctAccount && mainnet && state.authorizedDirectly && balanceExists;

      setAccount(signerAddress);
      setChainId(network.chainId.toString());
      setIsMainnet(mainnet);
      setIsCorrectAccount(correctAccount);
      setIsAuthorized(state.authorizedDirectly);
      setHasBalance(balanceExists);
      setRawBalance(state.balance);
      setDecimals(state.tokenDecimals);
      setSymbol(state.tokenSymbol);
      setAuthorizationValue(state.authValueAddress);

      if (!ready) {
        throw new Error("Verification failed. Please fix the checklist before withdrawing.");
      }

      const payload = buildInvoke0Payload({ rawAmount: state.balance });
      const wallet = new ethers.Contract(WALLET_ADDRESS, WALLET_ABI, signer);

      setMessage("Preparing withdrawal transaction…");
      const estimatedGas = await wallet.invoke0.estimateGas(payload);
      const gasLimit = (estimatedGas * 120n) / 100n;

      setMessage("Waiting for wallet confirmation…");
      const tx = await wallet.invoke0(payload, { gasLimit });
      setTxHash(tx.hash);
      setMessage("Transaction submitted. Waiting for confirmation…");

      const receipt = await tx.wait();
      if (receipt.status !== 1) {
        throw new Error("Transaction was mined but failed.");
      }

      const refreshed = await readState(provider, signerAddress);
      setRawBalance(refreshed.balance);
      setHasBalance(refreshed.balance > 0n);
      setMessage(
        `Done. The full ${symbol} balance was withdrawn to ${shortAddress(WITHDRAW_ADDRESS)}.`,
      );
    } catch (error) {
      console.error(error);
      setMessage(error?.shortMessage || error?.message || "Withdrawal failed.");
    } finally {
      setBusyAction("");
    }
  }

  const msgCls = {
    success: "border-emerald-500/20 bg-emerald-500/10 text-emerald-300",
    error: "border-red-500/20 bg-red-500/[0.08] text-red-300",
    info: "border-white/[0.06] bg-white/[0.02] text-neutral-400",
  }[messageType];

  return (
    <div
      className="min-h-screen bg-[#080b12]"
      style={{
        backgroundImage:
          "radial-gradient(ellipse 90% 50% at 50% -10%, rgba(109,40,217,0.18) 0%, transparent 60%)",
      }}
    >
      <div className="mx-auto max-w-[480px] px-4 py-12">
        {/* Header */}
        <div className="mb-8 text-center">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-violet-500/20 bg-violet-950/50 px-3 py-1">
            <span className="size-1.5 animate-pulse rounded-full bg-violet-400" />
            <span className="text-xs font-medium text-violet-300">
              Ethereum Mainnet · LEND Recovery
            </span>
          </div>
          <h1 className="text-[26px] font-semibold tracking-tight text-white">
            Smart Wallet Withdrawal
          </h1>
          <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-neutral-500">
            Withdraws the full LEND balance from the delegated smart-contract
            wallet to the owner address.
          </p>
        </div>

        {/* Card */}
        <div
          className="overflow-hidden rounded-2xl border border-white/[0.07] bg-white/[0.03]"
          style={{ boxShadow: "0 24px 80px -12px rgba(0,0,0,0.6)" }}
        >
          {/* Step 1 */}
          <div className="p-5">
            <StepHeader
              number={1}
              title="Connect Wallet"
              description={`Connect address ${shortAddress(WITHDRAW_ADDRESS)}`}
              status={account ? "Connected" : "Pending"}
              complete={Boolean(account)}
            />
            <div className="mt-4 space-y-2">
              <button
                onClick={connectWallet}
                disabled={busy}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-neutral-950 transition-all hover:bg-neutral-100 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busyAction === "connect" && <Spinner dark />}
                {account ? "Reconnect Wallet" : "Connect Wallet"}
              </button>
              {account && (
                <div className="flex items-center justify-between rounded-lg bg-black/20 px-3 py-2">
                  <span className="text-xs text-neutral-500">Connected</span>
                  <span className="font-mono text-xs text-neutral-300">
                    {shortAddress(account)}
                  </span>
                </div>
              )}
            </div>
          </div>

          <div className="h-px bg-white/[0.05]" />

          {/* Step 2 */}
          <div className="p-5">
            <StepHeader
              number={2}
              title="Verify Conditions"
              description="Checks network, authorization, and wallet balance."
              status={allGood ? "Ready" : "Pending"}
              complete={allGood}
            />
            <div className="mt-4 space-y-1.5">
              <CheckRow
                label="Correct signer"
                value={shortAddress(WITHDRAW_ADDRESS)}
                ok={isCorrectAccount}
              />
              <CheckRow
                label="Ethereum Mainnet"
                value={chainId ? `Chain ID ${chainId}` : "—"}
                ok={isMainnet}
              />
              <CheckRow
                label="invoke0 authorization"
                value={authorizationValue ? shortAddress(authorizationValue) : "—"}
                ok={isAuthorized}
              />
              <CheckRow
                label="LEND balance"
                value={`${formattedBalance} ${symbol}`}
                ok={hasBalance}
              />
            </div>
            <button
              onClick={verifyEverything}
              disabled={busy || !account}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.05] px-4 py-2.5 text-sm font-semibold text-white transition-all hover:bg-white/[0.09] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busyAction === "verify" && <Spinner />}
              Run Verification
            </button>
          </div>

          <div className="h-px bg-white/[0.05]" />

          {/* Step 3 */}
          <div className="p-5">
            <StepHeader
              number={3}
              title="Execute Withdrawal"
              description={`Transfers full balance to ${shortAddress(WITHDRAW_ADDRESS)}.`}
              status={txHash ? "Submitted" : "Pending"}
              complete={Boolean(txHash)}
            />
            <div className="mt-4 rounded-xl bg-black/30 px-4 py-4">
              <div className="text-xs text-neutral-500">Amount</div>
              <div className="mt-1 text-[22px] font-semibold tracking-tight text-white">
                {formattedBalance}{" "}
                <span className="text-lg text-neutral-400">{symbol}</span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-neutral-500">
                <span>Recipient:</span>
                <span className="font-mono text-neutral-400">
                  {shortAddress(WITHDRAW_ADDRESS)}
                </span>
                <span className="text-neutral-700">·</span>
                <span>From:</span>
                <span className="font-mono text-neutral-600">
                  {shortAddress(WALLET_ADDRESS)}
                </span>
              </div>
            </div>
            <button
              onClick={withdrawFullBalance}
              disabled={busy || !allGood}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-white transition-all hover:bg-emerald-400 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busyAction === "withdraw" && <Spinner />}
              Withdraw Full Balance
            </button>
            {txHash && (
              <a
                href={`https://etherscan.io/tx/${txHash}`}
                target="_blank"
                rel="noreferrer"
                className="mt-2.5 flex items-center justify-center gap-1.5 rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-4 py-2.5 text-sm font-medium text-emerald-400 transition hover:bg-emerald-500/15"
              >
                View on Etherscan
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  className="size-3.5"
                >
                  <path
                    fillRule="evenodd"
                    d="M4.25 5.5a.75.75 0 00-.75.75v8.5c0 .414.336.75.75.75h8.5a.75.75 0 00.75-.75v-4a.75.75 0 011.5 0v4A2.25 2.25 0 0112.75 17h-8.5A2.25 2.25 0 012 14.75v-8.5A2.25 2.25 0 014.25 4h5a.75.75 0 010 1.5h-5z"
                    clipRule="evenodd"
                  />
                  <path
                    fillRule="evenodd"
                    d="M6.194 12.753a.75.75 0 001.06.053L16.5 4.44v2.81a.75.75 0 001.5 0v-4.5a.75.75 0 00-.75-.75h-4.5a.75.75 0 000 1.5h2.553l-9.056 8.194a.75.75 0 00-.053 1.06z"
                    clipRule="evenodd"
                  />
                </svg>
              </a>
            )}
          </div>
        </div>

        {/* Status message */}
        <div className={`mt-4 rounded-xl border px-4 py-3 text-sm transition-all ${msgCls}`}>
          {message}
        </div>

        {/* Footer */}
        <div className="mt-6 flex flex-wrap justify-center gap-x-5 gap-y-1 text-xs text-neutral-700">
          <span>
            Smart wallet:{" "}
            <span className="font-mono">{shortAddress(WALLET_ADDRESS)}</span>
          </span>
          <span>
            LEND token:{" "}
            <span className="font-mono">{shortAddress(LEND_ADDRESS)}</span>
          </span>
        </div>
      </div>
    </div>
  );
}

function Spinner({ dark }) {
  return (
    <svg
      className={`size-4 animate-spin ${dark ? "text-neutral-950" : "text-white/70"}`}
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}

function StepHeader({ number, title, description, status, complete }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex items-start gap-3">
        <div
          className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
            complete
              ? "bg-emerald-400 text-neutral-950"
              : "bg-white/[0.08] text-neutral-400"
          }`}
        >
          {complete ? "✓" : number}
        </div>
        <div>
          <div className="text-sm font-semibold text-white">{title}</div>
          <div className="mt-0.5 text-xs text-neutral-500">{description}</div>
        </div>
      </div>
      <span
        className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-medium ${
          complete
            ? "border-emerald-500/20 bg-emerald-500/15 text-emerald-400"
            : "border-white/[0.07] bg-white/[0.04] text-neutral-500"
        }`}
      >
        {status}
      </span>
    </div>
  );
}

function CheckRow({ label, value, ok }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg bg-black/20 px-3 py-2.5">
      <div className="min-w-0">
        <div className="text-xs font-medium text-neutral-300">{label}</div>
        <div className="mt-0.5 truncate font-mono text-[10px] text-neutral-600">
          {value}
        </div>
      </div>
      <div
        className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
          ok
            ? "bg-emerald-500/15 text-emerald-400"
            : "bg-white/[0.05] text-neutral-600"
        }`}
      >
        {ok ? "✓" : "—"}
      </div>
    </div>
  );
}
