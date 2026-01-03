import React from "react";

const Footer: React.FC = () => {
  return (
    <footer className="w-full flex items-center justify-between py-1">
      <div className="flex items-center">
        <img
          src="/l.png"
          alt="Leafi"
          className="h-6 w-auto"
          draggable={false}
        />
      </div>
      <div className="flex flex-col gap-1">
        <div className="text-[10px] uppercase tracking-[0.2em] text-[#1a1b4b]/40 font-bold">
          © 2025 LEAFi: logistics enquiry and finalization. Premier Energies
        </div>
      </div>
      {/* Replace "Internal Access Only" with logo */}
    </footer>
  );
};

export default Footer;
