import { CreatePoolForm } from "@/components/create-pool-form";

export default function PoolsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[#ff1a1a]">Token Pools</h1>
        <p className="mt-1 text-[#888888]">
          Create a shielded pool for any ERC20 token. Paste the token contract
          address, look it up, and deploy a new pool. Once created, the token
          appears in the selector and anyone can deposit into it.
        </p>
        <p className="mt-2 text-[#666666] text-sm">
          For native AVAX: create a pool for WAVAX (Wrapped AVAX) using the
          quick-select button below. The deposit form will automatically wrap
          your native AVAX before depositing.
        </p>
      </div>
      <div className="max-w-md">
        <CreatePoolForm />
      </div>
    </div>
  );
}
