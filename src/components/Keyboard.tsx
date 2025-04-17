import { useState, useEffect } from "react";
import { useAppContext } from "../context/AppContext";

/**
 * Dex‑UI Keyboard — React port (no external deps)
 * -------------------------------------------------
 *  ▸ colours lifted from original C++ openFrameworks source
 *  ▸ flex layout reproduces row offsets / paddings
 *  ▸ basic key‑flash on keydown (desktop only)
 * -------------------------------------------------
 */
const labelFromKey = (k: string) =>
  ({
    Enter: "ENTER",
    Backspace: "BACK",
    " ": "SPACE",
  }[k] || k.toUpperCase());

// --- Colour palette --------------------------------------------------------
const COLORS = {
  bg: "transparent", // panel background
  keyIdle: "transparent", // normal key face
  keyText: "#9BAAA0", // key legend
  stroke: "#2F3C35", // outline / strokes
};

const isWideKey = (label: string) =>
  ["SHIFT", "CONTROL", "TAB", "BACK", "ENTER", "SPACE"].includes(label);

// By default map key label → width (approx px)
const widthForLabel = (label: string) => {
  if (label === "SPACE") return 420;
  if (isWideKey(label)) return 70; // wide keys
  if (label.length > 1) return 50; // e.g. ESC
  return 35; // normal alpha / symbols
};

function Key({
  label,
  active,
  specialKeys,
  setActiveKey,
}: {
  label: string;
  active: boolean;
  specialKeys: { shift: boolean; control: boolean; alt: boolean };
  setActiveKey: (lbl: string, down: boolean) => void;
}) {
  const { term } = useAppContext();

  const sendText = (txt: string) => {
    switch (txt) {
      case "ENTER":
        (term as any)._core._onData.fire("\r");
        break;
      case "BACK":
        term?.input("\x7F");
        break;
      case "SPACE":
        term?.input(" ");
        break;
      case "TAB":
        term?.input("\x09");
        break;
      default:
        term?.input(specialKeys.shift ? txt : txt.toLowerCase());
    }
  };

  const down = (e: any) => {
    e.preventDefault();
    setActiveKey(label, true);
    sendText(label);
  };

  const up = () => setActiveKey(label, false);

  const width = widthForLabel(label);

  return (
    <div
      onPointerDown={down}
      onPointerUp={up}
      onPointerLeave={up}
      className="dex-key"
      style={{
        width,
        background: active ? COLORS.stroke : COLORS.keyIdle,
        color: COLORS.keyText,
        borderRadius: 3,
        border: `1px solid ${COLORS.stroke}`,
        height: 35,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        marginRight: 10,
        fontFamily: "monospace",
        fontSize: label.length === 1 ? 14 : 10,
        letterSpacing: 1,
        transition: "background .1s, transform .1s",
        transform: active ? "translateY(2px)" : "translateY(0)",
        userSelect: "none",
      }}
    >
      {label}
    </div>
  );
}

// --- Row component ---------------------------------------------------------
function KeyRow({
  keys,
  style = {},
  activeKeys,
  specialKeys,
  setActiveKey,
}: {
  keys: string[];
  style?: any;
  activeKeys: Set<string>;
  specialKeys: { shift: boolean; control: boolean; alt: boolean };
  setActiveKey: (lbl: string, down: boolean) => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        paddingLeft: style.offset || 0,
        marginBottom: 10,
      }}
    >
      {keys.map((k) => (
        <Key
          key={k}
          label={k}
          specialKeys={specialKeys}
          active={activeKeys.has(k)}
          setActiveKey={setActiveKey}
        />
      ))}
    </div>
  );
}

// --- Main keyboard ---------------------------------------------------------
export default function Keyboard() {
  const [activeKeys, _setActiveKeys] = useState<Set<string>>(() => new Set());

  function setActiveKey(label: string, isDown: boolean) {
    _setActiveKeys((prev) => {
      const next = new Set(prev);
      isDown ? next.add(label) : next.delete(label);
      return next;
    });
  }

  // global physical keyboard -> highlight
  useEffect(() => {
    const press = (e: KeyboardEvent) => {
      if (e.ctrlKey) console.log("handle commands");
      else setActiveKey(labelFromKey(e.key), true);
    };
    const lift = (e: KeyboardEvent) => setActiveKey(labelFromKey(e.key), false);
    window.addEventListener("keydown", press, true);
    window.addEventListener("keyup", lift, true);
    return () => {
      window.removeEventListener("keydown", press, true);
      window.removeEventListener("keyup", lift, true);
    };
  }, []);
  const specialKeys = {
    shift: activeKeys.has("SHIFT"),
    alt: activeKeys.has("ALT"),
    control: activeKeys.has("CONTROL"),
  };
  return (
    <div
      style={{
        background: COLORS.bg,
        padding: 20,
        display: "inline-block",
      }}
    >
      <KeyRow
        specialKeys={specialKeys}
        activeKeys={activeKeys}
        setActiveKey={setActiveKey}
        keys={[
          "ESC",
          "1",
          "2",
          "3",
          "4",
          "5",
          "6",
          "7",
          "8",
          "9",
          "0",
          "-",
          "BACK",
        ]}
      />
      <KeyRow
        specialKeys={specialKeys}
        activeKeys={activeKeys}
        setActiveKey={setActiveKey}
        keys={["TAB", "Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P", "( )"]}
        style={{ offset: 25 }}
      />
      <KeyRow
        specialKeys={specialKeys}
        activeKeys={activeKeys}
        setActiveKey={setActiveKey}
        keys={[
          "CONTROL",
          "A",
          "S",
          "D",
          "F",
          "G",
          "H",
          "J",
          "K",
          "L",
          ";",
          "ENTER",
        ]}
        style={{ offset: 40 }}
      />
      <KeyRow
        specialKeys={specialKeys}
        activeKeys={activeKeys}
        setActiveKey={setActiveKey}
        keys={[
          "SHIFT",
          "Z",
          "X",
          "C",
          "V",
          "B",
          "N",
          "M",
          ",",
          ".",
          "/",
          "SHIFT",
        ]}
        style={{ offset: 25 }}
      />
      <div style={{ display: "flex", justifyContent: "center" }}>
        <Key
          specialKeys={specialKeys}
          label="SPACE"
          active={activeKeys.has("SPACE")}
          setActiveKey={setActiveKey}
        />
      </div>
    </div>
  );
}
