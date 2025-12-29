// root/src/components/login/Header.tsx
import React, { useEffect, useRef } from "react";
import "@google/model-viewer";

import fsModelUrl from "@/assets/fs.glb?url";

declare global {
  namespace JSX {
    interface IntrinsicElements {
      "model-viewer": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement>,
        HTMLElement
      > & {
        src?: string;
        alt?: string;
        "camera-controls"?: boolean;
        "disable-zoom"?: boolean;
        autoplay?: boolean;
        "auto-rotate"?: boolean;
        "rotation-per-second"?: string;
        exposure?: string | number;
        "shadow-intensity"?: string | number;
        "environment-image"?: string;
        "interaction-prompt"?: string;
        "interaction-prompt-style"?: string;
        "touch-action"?: string;
      };
    }
  }
}

function hexToRgba01(hex: string): [number, number, number, number] {
  const h = hex.replace("#", "").trim();
  const full =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h;
  const n = parseInt(full, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return [r / 255, g / 255, b / 255, 1];
}

// apply green to both material models:
// - pbrMetallicRoughness (standard)
// - pbrSpecularGlossiness (KHR extension; your GLB uses this)
function tintMaterialGreen(mat: any, green: [number, number, number, number]) {
  // Standard PBR
  if (mat?.pbrMetallicRoughness?.setBaseColorFactor) {
    mat.pbrMetallicRoughness.setBaseColorFactor(green);
    if (mat.pbrMetallicRoughness.setMetallicFactor) {
      mat.pbrMetallicRoughness.setMetallicFactor(0);
    }
    return true;
  }

  // SpecGloss (KHR_materials_pbrSpecularGlossiness)
  if (mat?.pbrSpecularGlossiness?.setDiffuseFactor) {
    mat.pbrSpecularGlossiness.setDiffuseFactor(green);
    return true;
  }

  // last-resort: some internal three.js material
  if (mat?.color?.set) {
    mat.color.set("#22c55e");
    mat.needsUpdate = true;
    return true;
  }

  return false;
}

export default function Header() {
  const mvRef = useRef<any>(null);

  useEffect(() => {
    const el = mvRef.current as any;
    if (!el) return;

    const LEAF_GREEN = "#57a869";
    const green = hexToRgba01(LEAF_GREEN);

    const applyTint = () => {
      try {
        const mats: any[] = el.model?.materials || [];
        if (!mats.length) return;

        let changed = 0;

        // 1) try by name first
        for (const m of mats) {
          const name = String(m?.name || "").toLowerCase();
          const looksLikeLeaf =
            name.includes("leaf") ||
            name.includes("leafi") ||
            name.includes("foliage") ||
            name.includes("plant");

          if (looksLikeLeaf) {
            if (tintMaterialGreen(m, green)) changed++;
          }
        }

        // 2) if names aren't preserved, tint ALL (safe for your logo GLB)
        if (changed === 0) {
          for (const m of mats) {
            if (tintMaterialGreen(m, green)) changed++;
          }
        }

        // 3) force a render tick (helps some webviews)
        if (changed > 0 && typeof el.requestUpdate === "function") {
          el.requestUpdate();
        }
      } catch {
        // ignore
      }
    };

    // Some webviews fire load differently; handle both.
    el.addEventListener("load", applyTint);
    el.addEventListener("model-visibility", applyTint);

    // If model already loaded before listener attached
    if (el.model) applyTint();

    return () => {
      el.removeEventListener("load", applyTint);
      el.removeEventListener("model-visibility", applyTint);
    };
  }, []);

  return (
    <header className="w-full flex items-center justify-between">
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-lg overflow-hidden bg-white/30">
          <model-viewer
            ref={mvRef}
            src={fsModelUrl}
            alt="Leafi logo"
            autoplay
            auto-rotate
            disable-zoom
            exposure="1.0"
            shadow-intensity="0"
            rotation-per-second="30deg"
            interaction-prompt="none"
            touch-action="none"
            style={{ width: "32px", height: "32px", display: "block" }}
          />
        </div>

        <div className="flex flex-col leading-none">
          <span className="font-bold text-lg tracking-tight text-[#1a1b4b]">
            Leafi
          </span>
        </div>
      </div>

      <div className="hidden md:flex items-center gap-2 text-xs font-medium text-[#1a1b4b]/40">
        <span className="w-2 h-2 rounded-full bg-emerald-500" />
        System Operational
      </div>
    </header>
  );
}
