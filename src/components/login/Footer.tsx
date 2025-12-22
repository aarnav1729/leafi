import React from "react";

const Footer: React.FC = () => {
  return (
    <footer className="w-full flex items-center justify-between py-1">
      <div className="flex flex-col gap-1">
        <div className="text-[10px] uppercase tracking-[0.2em] text-[#1a1b4b]/40 font-bold">
          © 2025 Leafi Digital
        </div>
        <div className="text-[10px] text-[#1a1b4b]/25 italic font-medium">
          Designed by Aarnav Singh
        </div>
      </div>

      <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-[#1a1b4b]/30">
        Internal Access Only
      </div>
    </footer>
  );
};

export default Footer;
