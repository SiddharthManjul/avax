"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface PinInputProps {
  length?: number;
  onComplete: (pin: string) => void;
  error?: string | null;
  disabled?: boolean;
}

export function PinInput({ length = 6, onComplete, error, disabled }: PinInputProps) {
  const [digits, setDigits] = useState<string[]>(Array(length).fill(""));
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Auto-focus first input on mount
  useEffect(() => {
    inputRefs.current[0]?.focus();
  }, []);

  // Clear on error change
  useEffect(() => {
    if (error) {
      setDigits(Array(length).fill(""));
      setTimeout(() => inputRefs.current[0]?.focus(), 100);
    }
  }, [error, length]);

  const handleChange = useCallback(
    (index: number, value: string) => {
      // Only allow single digit
      const digit = value.replace(/\D/g, "").slice(-1);
      const next = [...digits];
      next[index] = digit;
      setDigits(next);

      if (digit && index < length - 1) {
        inputRefs.current[index + 1]?.focus();
      }

      // Check if complete
      if (digit && next.every((d) => d !== "")) {
        onComplete(next.join(""));
      }
    },
    [digits, length, onComplete]
  );

  const handleKeyDown = useCallback(
    (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Backspace" && !digits[index] && index > 0) {
        inputRefs.current[index - 1]?.focus();
        const next = [...digits];
        next[index - 1] = "";
        setDigits(next);
      }
    },
    [digits]
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      e.preventDefault();
      const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, length);
      if (pasted.length === 0) return;

      const next = Array(length).fill("");
      for (let i = 0; i < pasted.length && i < length; i++) {
        next[i] = pasted[i];
      }
      setDigits(next);

      if (pasted.length >= length) {
        onComplete(next.join(""));
      } else {
        inputRefs.current[pasted.length]?.focus();
      }
    },
    [length, onComplete]
  );

  return (
    <div className="space-y-3">
      <div className="flex justify-center gap-2" onPaste={handlePaste}>
        {digits.map((digit, i) => (
          <input
            key={i}
            ref={(el) => { inputRefs.current[i] = el; }}
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={1}
            value={digit}
            onChange={(e) => handleChange(i, e.target.value)}
            onKeyDown={(e) => handleKeyDown(i, e)}
            disabled={disabled}
            className={`
              w-11 h-14 text-center text-xl font-mono rounded-lg border
              bg-[#0d0d0d] focus:outline-none transition-colors duration-200
              ${error
                ? "border-[#ff1a1a] text-[#ff1a1a]"
                : "border-[#2a2a2a] text-[#ff1a1a] focus:border-[#ff1a1a]"
              }
              ${disabled ? "opacity-40" : ""}
            `}
          />
        ))}
      </div>
      {error && (
        <p className="text-center text-sm text-[#ff1a1a]">{error}</p>
      )}
    </div>
  );
}
