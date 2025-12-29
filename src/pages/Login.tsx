import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";

import Header from "@/components/login/Header";
import Footer from "@/components/login/Footer";
import HeroContent from "@/components/login/HeroContent";
import InteractiveGrid, { GridTheme } from "@/components/login/InteractiveGrid";

const Login: React.FC = () => {
  const navigate = useNavigate();
  const { requestOtp, verifyOtp } = useAuth();

  const [email, setEmail] = useState("");

  const theme: GridTheme = useMemo(
    () => ({
      cursor: "🚢",
      gradient: {
        start: { r: 12, g: 65, b: 35 },
        end: { r: 122, g: 184, b: 0 },
      },
      bgColor: "#FAF9F6",
    }),
    []
  );

  const handleSendOTP = async (inputEmail: string) => {
    const e = inputEmail.trim();
    if (!e) return false;
    setEmail(e);
    return await requestOtp(e);
  };

  const handleVerifyOTP = async (inputOtp: string) => {
    const ok = await verifyOtp(email.trim(), inputOtp.trim());
    if (ok) {
      // ✅ go straight to app (no particle/logo animation)
      navigate("/app", { replace: true });
    }
    return ok;
  };

  return (
    <div
      className="relative w-screen h-screen overflow-hidden transition-colors duration-700 text-[#1a1b4b]"
      style={{ backgroundColor: theme.bgColor }}
    >
      {/* Background (kept), but logo formation is NEVER triggered */}
      <InteractiveGrid isFormingShape={false} theme={theme} />

      {/* Foreground */}
      <div className="absolute inset-0 flex flex-col justify-between py-6 pointer-events-none">
        <div className="w-[90%] mx-auto pointer-events-auto">
          <div className="bg-white/40 backdrop-blur-md border border-white/20 shadow-sm rounded-2xl px-6 py-3">
            <Header />
          </div>
        </div>

        <div className="flex-1 flex items-center justify-center pointer-events-none">
          <div className="pointer-events-auto w-full flex justify-center">
            <HeroContent
              onSendOTP={handleSendOTP}
              onVerifyOTP={handleVerifyOTP}
            />
          </div>
        </div>

        <div className="w-[90%] mx-auto pointer-events-auto">
          <div className="bg-white/40 backdrop-blur-md border border-white/20 shadow-sm rounded-2xl px-6 py-3">
            <Footer />
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;
