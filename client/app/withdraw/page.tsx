import { WithdrawForm } from "@/components/withdraw-form";

export default function WithdrawPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[#ff1a1a]">Withdraw</h1>
        <p className="mt-1 text-[#888888]">
          Exit tokens from the shielded pool to any EVM address. The withdrawal
          amount is visible, but the link to the original depositor is broken.
        </p>
      </div>
      <div className="max-w-md">
        <WithdrawForm />
      </div>
    </div>
  );
}
