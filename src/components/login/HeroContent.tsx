import React, { useState } from "react";

interface HeroContentProps {
  onSendOTP: (email: string) => Promise<boolean>;
  onVerifyOTP: (otp: string) => Promise<boolean>;
}

const HeroContent: React.FC<HeroContentProps> = ({
  onSendOTP,
  onVerifyOTP,
}) => {
  const [step, setStep] = useState<"email" | "otp">("email");
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const isButtonEnabled = inputValue.trim().length >= 3;

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!isButtonEnabled || isLoading) return;

    setIsLoading(true);
    try {
      if (step === "email") {
        const ok = await onSendOTP(inputValue.trim());
        if (ok) {
          setStep("otp");
          setInputValue("");
        }
      } else {
        const ok = await onVerifyOTP(inputValue.trim());
        if (ok) {
          // Login.tsx will move to loading state
        }
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center w-full max-w-[520px] px-4 z-10 pointer-events-auto transition-all duration-500">
      <div className="w-full bg-[#FAF9F6]/80 backdrop-blur-sm p-6 md:p-10 rounded-3xl border border-[#1a1b4b]/5 shadow-sm">
        <form onSubmit={handleSubmit} className="flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <label
              htmlFor="input-field"
              className="text-[#1a1b4b] font-semibold text-xs uppercase tracking-[0.2em] ml-1"
            >
              {step === "email" ? "Enterprise Email" : "Verification Code"}
            </label>

            <input
              id="input-field"
              type="text" // <-- allows "aarnav" without requiring "@"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder={step === "email" ? "username or email" : "••••"}
              className="w-full bg-white border border-[#1a1b4b]/10 rounded-xl p-4 text-[#1a1b4b] placeholder-[#1a1b4b]/30 focus:outline-none focus:ring-4 focus:ring-[#0066b2]/5 transition-all text-lg"
              autoFocus
              inputMode={step === "otp" ? "numeric" : "email"} // optional nicety
            />

            {step === "otp" && (
              <p className="text-xs text-[#1a1b4b]/45 mt-1">
                OTP is printed in the server console (MVP).
              </p>
            )}
          </div>

          <div className="flex justify-end">
            <button
              disabled={!isButtonEnabled || isLoading}
              type="submit"
              className={`
                px-10 py-4 rounded-xl font-bold text-sm transition-all duration-300 transform
                flex items-center gap-3 active:scale-95 uppercase tracking-widest
                ${
                  isButtonEnabled && !isLoading
                    ? "bg-[#1a1b4b] text-white shadow-xl hover:shadow-2xl hover:-translate-y-1 hover:bg-[#2a2b5b]"
                    : "bg-[#1a1b4b]/5 text-[#1a1b4b]/30 cursor-not-allowed"
                }
              `}
            >
              {isLoading ? (
                <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <span>{step === "email" ? "Continue" : "Authorize"}</span>
              )}

              {!isLoading && (
                <svg
                  className="w-4 h-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M14 5l7 7m0 0l-7 7m7-7H3"
                  />
                </svg>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default HeroContent;
