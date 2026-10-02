// English dictionary, keyed by the French source text. One file per area keeps parallel edits apart.
import { agents } from "./agents";
import { app } from "./app";
import { chat } from "./chat";
import { knowledge } from "./knowledge";
import { machine } from "./machine";
import { models } from "./models";
import { projects } from "./projects";

export const EN: Record<string, string> = { ...app, ...agents, ...chat, ...knowledge, ...models, ...projects, ...machine };
