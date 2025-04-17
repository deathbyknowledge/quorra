import React, {type PropsWithChildren, useEffect, useRef, useState, useMemo } from "react";
import { v4 as uuidv4 } from "uuid"; // Install with: npm install uuid

const LoadingBorderWrapper: React.FC<
  PropsWithChildren<{
    borderColor?: string;
    borderWidth?: string;
    animationSpeed?: number;
    onFinish?: () => void;
  }>
> = ({
  children,
  borderColor = "#000000",
  borderWidth = "1px",
  animationSpeed = 1,
  onFinish
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const uniqueId = useMemo(() => uuidv4(), []); // Unique ID for this instance

  // Measure the container’s dimensions after mounting
  useEffect(() => {
    if (containerRef.current) {
      const { offsetWidth, offsetHeight } = containerRef.current;
      setDimensions({ width: offsetWidth, height: offsetHeight });
    }
  }, []);

  const { width, height } = dimensions;
  const totalPerimeter = 2 * (width + height);
  const segmentTime = (length: number) => (length / totalPerimeter) * animationSpeed * 3;

  const bottomTime = segmentTime(width / 2); // Bottom segments
  const sideTime = segmentTime(height);      // Side segments
  const topTime = segmentTime(width / 2);    // Top segments

  // Apply final border and hide segments after animation
  useEffect(() => {
    if (!containerRef.current || width === 0 || height === 0) return;
    const topRight = containerRef.current.querySelector(`.top-right-${uniqueId}`);
    const handleAnimationEnd = () => {
      if (containerRef.current) {
        containerRef.current.style.border = `${borderWidth} solid ${borderColor}`;
        containerRef.current
          .querySelectorAll(`.border-segment-${uniqueId}`)
          .forEach((segment: any) => {
            segment.style.display = "none";
          });
      }
      if (onFinish) onFinish();
    };

    topRight?.addEventListener("animationend", handleAnimationEnd);
    return () => topRight?.removeEventListener("animationend", handleAnimationEnd);
  }, [borderColor, borderWidth, width, height, uniqueId]);

  // Base styles for all segments
  const segmentStyles = {
    position: "absolute" as const,
    zIndex: 10,
    backgroundColor: borderColor,
  };

  // Inline styles for each segment
  const bottomLeftStyles = {
    ...segmentStyles,
    bottom: `-${borderWidth}`,
    right: "50%",
    width: 0,
    height: borderWidth,
    animation: `growWidth-${uniqueId} ${bottomTime}s linear forwards`,
  };

  const bottomRightStyles = {
    ...segmentStyles,
    bottom: `-${borderWidth}`,
    left: "50%",
    width: 0,
    height: borderWidth,
    animation: `growWidth-${uniqueId} ${bottomTime}s linear forwards`,
  };

  const leftSideStyles = {
    ...segmentStyles,
    left: `-${borderWidth}`,
    bottom: 0,
    width: borderWidth,
    height: 0,
    animation: `growHeight-${uniqueId} ${sideTime}s linear ${bottomTime}s forwards`,
  };

  const rightSideStyles = {
    ...segmentStyles,
    right: `-${borderWidth}`,
    bottom: 0,
    width: borderWidth,
    height: 0,
    animation: `growHeight-${uniqueId} ${sideTime}s linear ${bottomTime}s forwards`,
  };

  const topLeftStyles = {
    ...segmentStyles,
    top: `-${borderWidth}`,
    left: `-${borderWidth}`,
    width: 0,
    height: borderWidth,
    animation: `growWidth-${uniqueId} ${topTime}s linear ${bottomTime + sideTime}s forwards`,
  };

  const topRightStyles = {
    ...segmentStyles,
    top: `-${borderWidth}`,
    right: `-${borderWidth}`,
    width: 0,
    height: borderWidth,
    animation: `growWidth-${uniqueId} ${topTime}s linear ${bottomTime + sideTime}s forwards`,
  };

  return (
    <div
      ref={containerRef}
      style={{
        height: "100%",
        width: "100%",
        position: "relative",
        border: `${borderWidth} solid transparent`, // Transparent until animation completes
      }}
    >
      {/* Inject unique keyframes for this instance */}
      <style>
        {`
          @keyframes growWidth-${uniqueId} {
            to { width: calc(50% + ${borderWidth}); }
          }
          @keyframes growHeight-${uniqueId} {
            to { height: calc(100% + ${borderWidth}); }
          }
        `}
      </style>

      {/* Border segments with inline styles */}
      <div className={`border-segment-${uniqueId}`} style={bottomLeftStyles}></div>
      <div className={`border-segment-${uniqueId}`} style={bottomRightStyles}></div>
      <div className={`border-segment-${uniqueId}`} style={leftSideStyles}></div>
      <div className={`border-segment-${uniqueId}`} style={rightSideStyles}></div>
      <div className={`border-segment-${uniqueId}`} style={topLeftStyles}></div>
      <div className={`border-segment-${uniqueId} top-right-${uniqueId}`} style={topRightStyles}></div>

      {/* Render children */}
      {children}
    </div>
  );
};

export default LoadingBorderWrapper;