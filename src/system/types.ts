import {AppContext} from "../context/AppContext";

export type CommandFn = (args: string[], ctx: AppContext) => void | Promise<void>;

export type FSEntry = {
  type: "file" | "dir";
  path: string;
  size?: number;
  ts?: Date;
  owner: string;
};