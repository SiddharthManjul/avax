/* eslint-disable @typescript-eslint/no-explicit-any */
declare module "snarkjs" {
  export const groth16: {
    fullProve(
      input: Record<string, any>,
      wasmPath: string,
      zkeyPath: string
    ): Promise<{ proof: any; publicSignals: string[] }>;
    verify(
      verificationKey: any,
      publicSignals: string[],
      proof: any
    ): Promise<boolean>;
  };
}
