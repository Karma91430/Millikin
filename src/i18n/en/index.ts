// English dictionary, keyed by the French source text. One file per area keeps parallel edits apart.
import { admin } from "./admin";
import { agents } from "./agents";
import { app } from "./app";
import { bench } from "./bench";
import { chat } from "./chat";
import { knowledge } from "./knowledge";
import { machine } from "./machine";
import { models } from "./models";
import { pilot } from "./pilot";
import { projects } from "./projects";

export const EN: Record<string, string> = { ...app, ...admin, ...agents, ...chat, ...knowledge, ...models, ...projects, ...machine, ...pilot, ...bench };
