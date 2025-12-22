import React, { useEffect, useRef } from "react";

export interface GridTheme {
  cursor: string;
  gradient: {
    start: { r: number; g: number; b: number };
    end: { r: number; g: number; b: number };
  };
  bgColor: string;
}

interface Point {
  x: number;
  y: number;
  originX: number;
  originY: number;
  vx: number;
  vy: number;
  angle: number;
  visible: boolean;
  targetColor?: string;
}

interface InteractiveGridProps {
  isFormingShape: boolean;
  onShapeFormationComplete?: () => void;
  theme: GridTheme;
}

const InteractiveGrid: React.FC<InteractiveGridProps> = ({
  isFormingShape,
  onShapeFormationComplete,
  theme,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const completionTriggeredRef = useRef(false);

  const GRID_SPACING = 24;
  const LEAF_SIZE = 5;
  const CURSOR_SIZE = "16px";
  const INTERACTION_RADIUS = 100;

  const STIFFNESS = 0.006;
  const DAMPING = 0.72;
  const REPULSION_FORCE = 0.11;

  const LOGO_BLUE = "rgb(0, 102, 178)";
  const LOGO_GREEN = "rgb(122, 184, 0)";
  const HIGHLIGHT = { r: 253, g: 224, b: 71 };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let width = window.innerWidth;
    let height = window.innerHeight;
    let mouseX = -1000;
    let mouseY = -1000;
    let points: Point[] = [];
    let animationFrameId: number;

    const lerp = (start: number, end: number, t: number) =>
      start + (end - start) * t;

    const getMargins = () => ({
      horizontal: width * 0.05,
      vertical: 100,
    });

    const getLogoTargets = (cx: number, cy: number) => {
      const targets: { x: number; y: number; color: string }[] = [];
      const scale = 8;

      const addCurve = (
        startX: number,
        startY: number,
        cp1x: number,
        cp1y: number,
        cp2x: number,
        cp2y: number,
        endX: number,
        endY: number,
        steps: number,
        color: string
      ) => {
        for (let i = 0; i <= steps; i++) {
          const t = i / steps;
          const x =
            Math.pow(1 - t, 3) * startX +
            3 * Math.pow(1 - t, 2) * t * cp1x +
            3 * (1 - t) * Math.pow(t, 2) * cp2x +
            Math.pow(t, 3) * endX;
          const y =
            Math.pow(1 - t, 3) * startY +
            3 * Math.pow(1 - t, 2) * t * cp1y +
            3 * (1 - t) * Math.pow(t, 2) * cp2y +
            Math.pow(t, 3) * endY;
          targets.push({ x: cx + x * scale, y: cy + y * scale, color });
        }
      };

      addCurve(-20, -10, -10, -40, 40, -40, 40, 0, 40, LOGO_GREEN);
      addCurve(40, 0, 40, 30, 0, 30, -10, 20, 30, LOGO_GREEN);
      addCurve(-20, -10, -10, 0, 20, 0, 20, 0, 15, LOGO_BLUE);
      addCurve(-15, -15, -5, -35, 35, -35, 35, -5, 30, LOGO_BLUE);
      addCurve(-10, -20, 0, -30, 30, -30, 30, -10, 25, LOGO_BLUE);
      addCurve(-25, 10, -35, 10, -35, 50, 0, 60, 40, LOGO_GREEN);
      addCurve(-25, 10, -20, 20, -10, 50, 0, 60, 30, LOGO_GREEN);
      addCurve(-30, 15, -30, 40, -10, 50, -5, 55, 25, LOGO_GREEN);

      return targets;
    };

    const initGrid = () => {
      points = [];
      const margins = getMargins();
      const activeWidth = width - 2 * margins.horizontal;
      const activeHeight = height - 2 * margins.vertical;
      if (activeWidth <= 0 || activeHeight <= 0) return;

      const cols = Math.floor(activeWidth / GRID_SPACING);
      const rows = Math.floor(activeHeight / GRID_SPACING);
      const offsetX =
        margins.horizontal + (activeWidth - (cols - 1) * GRID_SPACING) / 2;
      const offsetY =
        margins.vertical + (activeHeight - (rows - 1) * GRID_SPACING) / 2;

      // Hole around the login card (so dots remain on the sides like a rectangle)
      const safeZoneWidth = Math.min(560, width * 0.92); // ~ max-w + padding (tune 620)
      const safeZoneHeight = Math.min(360, height * 0.6); // enough for input + button

      const sxStart = width / 2 - safeZoneWidth / 2;
      const sxEnd = width / 2 + safeZoneWidth / 2;
      const syStart = height / 2 - safeZoneHeight / 2;
      const syEnd = height / 2 + safeZoneHeight / 2;

      for (let i = 0; i < cols; i++) {
        for (let j = 0; j < rows; j++) {
          const x = offsetX + i * GRID_SPACING;
          const y = offsetY + j * GRID_SPACING;
          const isInsideHole =
            x > sxStart && x < sxEnd && y > syStart && y < syEnd;

          points.push({
            x,
            y,
            originX: x,
            originY: y,
            vx: 0,
            vy: 0,
            angle: Math.random() * Math.PI,
            visible: !isInsideHole,
            targetColor: "#1a1b4b",
          });
        }
      }
    };

    const drawLeaf = (
      x: number,
      y: number,
      size: number,
      angle: number,
      color: string
    ) => {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle);
      ctx.fillStyle = color;

      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.bezierCurveTo(
        size * 0.5,
        -size * 1.5,
        size * 2.5,
        -size * 0.8,
        size * 3.5,
        0
      );
      ctx.bezierCurveTo(size * 2.5, size * 0.8, size * 0.5, size * 1.5, 0, 0);
      ctx.fill();

      ctx.beginPath();
      ctx.strokeStyle = "rgba(0,0,0,0.08)";
      ctx.lineWidth = 0.5;
      ctx.moveTo(0, 0);
      ctx.lineTo(size * 3, 0);
      ctx.stroke();

      ctx.restore();
    };

    const updatePointsForShape = () => {
      const logoTargets = getLogoTargets(width / 2, height / 2);

      logoTargets.forEach((target, index) => {
        if (index < points.length) {
          const p = points[index];
          p.originX = target.x;
          p.originY = target.y;
          p.targetColor = target.color;
          p.visible = true;
        }
      });

      for (let i = logoTargets.length; i < points.length; i++) {
        points[i].originX = points[i].x + (Math.random() - 0.5) * 800;
        points[i].originY = points[i].y + (Math.random() - 0.5) * 800;
        points[i].visible = false;
      }
    };

    const render = () => {
      ctx.clearRect(0, 0, width, height);
      let allSettled = true;

      points.forEach((point) => {
        if (!isFormingShape) {
          const dx = point.x - mouseX;
          const dy = point.y - mouseY;
          const distance = Math.sqrt(dx * dx + dy * dy);
          if (distance < INTERACTION_RADIUS) {
            const angle = Math.atan2(dy, dx);
            const force = (INTERACTION_RADIUS - distance) / INTERACTION_RADIUS;
            point.vx += Math.cos(angle) * force * REPULSION_FORCE * 15;
            point.vy += Math.sin(angle) * force * REPULSION_FORCE * 15;
            point.angle += force * 0.11;
          }
        }

        const ox = point.originX - point.x;
        const oy = point.originY - point.y;

        const currentStiffness = isFormingShape ? 0.04 : STIFFNESS;
        point.vx += ox * currentStiffness;
        point.vy += oy * currentStiffness;

        point.vx *= DAMPING;
        point.vy *= DAMPING;

        point.x += point.vx;
        point.y += point.vy;

        point.angle += (point.vx + point.vy) * 0.02;

        if (isFormingShape) {
          if (
            Math.abs(point.vx) > 0.05 ||
            Math.abs(point.vy) > 0.05 ||
            Math.abs(ox) > 0.5
          )
            allSettled = false;
        }

        if (!point.visible && !isFormingShape) return;
        if (isFormingShape && !point.visible) return;

        let finalColor = "";
        if (isFormingShape && point.targetColor) {
          finalColor = point.targetColor;
        } else {
          const yRatio = Math.max(0, Math.min(1, point.originY / height));
          const baseR = lerp(
            theme.gradient.start.r,
            theme.gradient.end.r,
            yRatio
          );
          const baseG = lerp(
            theme.gradient.start.g,
            theme.gradient.end.g,
            yRatio
          );
          const baseB = lerp(
            theme.gradient.start.b,
            theme.gradient.end.b,
            yRatio
          );

          const disp = Math.sqrt(
            (point.x - point.originX) ** 2 + (point.y - point.originY) ** 2
          );
          const t = Math.min(Math.max(disp / 12, 0), 1);

          if (t > 0.1) {
            const r = Math.round(lerp(baseR, HIGHLIGHT.r, t));
            const g = Math.round(lerp(baseG, HIGHLIGHT.g, t));
            const b = Math.round(lerp(baseB, HIGHLIGHT.b, t));
            finalColor = `rgb(${r}, ${g}, ${b})`;
          } else {
            finalColor = `rgb(${Math.round(baseR)}, ${Math.round(
              baseG
            )}, ${Math.round(baseB)})`;
          }
        }

        drawLeaf(point.x, point.y, LEAF_SIZE, point.angle, finalColor);
      });

      if (!isFormingShape && mouseX > -500) {
        ctx.save();
        ctx.font = `${CURSOR_SIZE} sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(theme.cursor, mouseX, mouseY);
        ctx.restore();
      }

      if (isFormingShape && allSettled && !completionTriggeredRef.current) {
        setTimeout(() => {
          if (onShapeFormationComplete) onShapeFormationComplete();
        }, 800);
        completionTriggeredRef.current = true;
      }

      animationFrameId = requestAnimationFrame(render);
    };

    const handleResize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = width;
      canvas.height = height;
      initGrid();
      if (isFormingShape) updatePointsForShape();
    };

    const handleMouseMove = (e: MouseEvent) => {
      mouseX = e.clientX;
      mouseY = e.clientY;
    };
    const handleMouseLeave = () => {
      mouseX = -1000;
      mouseY = -1000;
    };

    handleResize();
    window.addEventListener("resize", handleResize);
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseout", handleMouseLeave);

    if (isFormingShape) updatePointsForShape();
    render();

    return () => {
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseout", handleMouseLeave);
      cancelAnimationFrame(animationFrameId);
    };
  }, [isFormingShape, theme, onShapeFormationComplete]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full block touch-none z-0"
    />
  );
};

export default InteractiveGrid;
