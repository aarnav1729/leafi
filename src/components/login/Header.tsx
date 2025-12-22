import React from "react";

const Header: React.FC = () => {
  return (
    <header className="w-full flex items-center justify-between">
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 relative">
          <div className="absolute top-0 right-0 w-6 h-4 bg-[#0066b2] rounded-tr-lg rounded-tl-lg" />
          <div className="absolute bottom-0 left-0 w-4 h-5 bg-[#7ab800] rounded-bl-lg" />
        </div>

        <div className="flex flex-col leading-none">
          <span className="font-bold text-lg tracking-tight text-[#1a1b4b]">
            Leafi
          </span>
          <span className="font-medium text-xs tracking-wider text-[#1a1b4b]/60 uppercase">
            Digital
          </span>
        </div>
      </div>

      <div className="hidden md:flex items-center gap-2 text-xs font-medium text-[#1a1b4b]/40">
        <span className="w-2 h-2 rounded-full bg-emerald-500" />
        System Operational
      </div>
    </header>
  );
};

export default Header;
