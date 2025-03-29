import React from "react";

export const Header: React.FC<{left: string, right: string}> = ({left, right}) => {
  return (
    <div
      style={{
        borderBottom: "1px solid var(--color-line)",
        display: "flex",
        justifyContent: "space-between",
        color: "var(--color-line)",
        fontSize: '10px',
        fontFamily: "monospace",
paddingLeft: '10px',
paddingRight: '10px',
        paddingBottom:'5px',
        position: 'relative'
      }}
    >
      <span>{left}</span>
      <span>{right}</span>
      <div style={{height: "9px", width: "1px", position: "absolute", backgroundColor: "var(--color-line)", right: 0, bottom: -5 }}/>
      <div style={{height: "9px", width: "1px", position: "absolute", backgroundColor: "var(--color-line)", left: 0, bottom: -5 }}/>
    </div>
  );
};
