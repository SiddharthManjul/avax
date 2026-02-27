import { DepositForm } from "@/components/deposit-form";

export default function DepositPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Deposit</h1>
        <p className="mt-1 text-zinc-400">
          Lock ERC20 tokens into the shielded pool. The deposit amount is visible
          on-chain, but all subsequent transfers are private.
        </p>
      </div>
      <div className="max-w-md">
        <DepositForm />
      </div>
    </div>
  );
}
