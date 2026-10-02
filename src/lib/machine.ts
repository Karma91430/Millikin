// Hardware detection and Ollama model recommendations. Estimates are deliberately simple: a model
// needs its weights plus a KV cache that grows with the context; generation speed is bounded by
// memory bandwidth divided by the size of the weights read for each token.
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import { promisify } from "node:util";

const run = promisify(execFile);
const sh = async (cmd: string, args: string[]) => {
  try {
    return (await run(cmd, args, { timeout: 8000, maxBuffer: 4 << 20 })).stdout.trim();
  } catch {
    return "";
  }
};
const GB = 1024 ** 3;

export type Gpu = { name: string; vramGB?: number; cores?: number; kind: "apple" | "nvidia" | "other" };
export type Hardware = {
  os: string;
  arch: string;
  cpu: string;
  cores: number;
  perfCores?: number;
  ramGB: number;
  freeRamGB: number;
  unified: boolean;
  gpus: Gpu[];
  diskFreeGB?: number;
  /** Memory a model can realistically use (GPU memory, or unified memory minus the system's share). */
  modelMemoryGB: number;
  /** Rough memory bandwidth in GB/s, used to estimate generation speed. */
  bandwidthGBs: number;
  acceleration: "metal" | "cuda" | "cpu";
};

// Unified-memory bandwidth of Apple chips (GB/s), from the vendor specs.
const APPLE_BANDWIDTH: [RegExp, number][] = [
  [/M4 Max/, 546],
  [/M4 Pro/, 273],
  [/M4/, 120],
  [/M3 Ultra/, 819],
  [/M3 Max/, 400],
  [/M3 Pro/, 150],
  [/M3/, 100],
  [/M2 Ultra/, 800],
  [/M2 Max/, 400],
  [/M2 Pro/, 200],
  [/M2/, 100],
  [/M1 Ultra/, 800],
  [/M1 Max/, 400],
  [/M1 Pro/, 200],
  [/M1/, 68],
];

export async function detectHardware(): Promise<Hardware> {
  const platform = os.platform();
  const cpus = os.cpus();
  const ramGB = os.totalmem() / GB;
  let cpu = cpus[0]?.model?.trim() || "CPU";
  let perfCores: number | undefined;
  const gpus: Gpu[] = [];

  if (platform === "darwin") {
    cpu = (await sh("sysctl", ["-n", "machdep.cpu.brand_string"])) || cpu;
    perfCores = Number(await sh("sysctl", ["-n", "hw.perflevel0.physicalcpu"])) || undefined;
    const raw = await sh("system_profiler", ["SPDisplaysDataType", "-json"]);
    try {
      for (const g of (JSON.parse(raw).SPDisplaysDataType ?? []) as Record<string, string>[]) {
        const name = g.sppci_model || g._name || "GPU";
        gpus.push({ name, cores: Number(g.sppci_cores) || undefined, kind: /Apple/.test(name) ? "apple" : "other" });
      }
    } catch {}
  }
  const nvidia = await sh("nvidia-smi", ["--query-gpu=name,memory.total", "--format=csv,noheader,nounits"]);
  for (const line of nvidia.split("\n").filter(Boolean)) {
    const [name, mem] = line.split(",").map((x) => x.trim());
    gpus.push({ name, vramGB: Number(mem) / 1024, kind: "nvidia" });
  }

  let diskFreeGB: number | undefined;
  try {
    const st = await fs.statfs(os.homedir());
    diskFreeGB = (st.bavail * st.bsize) / GB;
  } catch {}

  const unified = platform === "darwin" && os.arch() === "arm64";
  const vram = gpus.filter((g) => g.kind === "nvidia").reduce((s, g) => s + (g.vramGB ?? 0), 0);
  // macOS lets the GPU wire about 2/3 of memory on small configurations, 3/4 above 36 GB.
  const modelMemoryGB = unified ? ramGB * (ramGB > 36 ? 0.75 : 0.67) : vram > 0 ? vram * 0.92 : ramGB * 0.6;
  const bandwidthGBs = unified ? (APPLE_BANDWIDTH.find(([re]) => re.test(cpu))?.[1] ?? 100) : vram > 0 ? 450 : 40;

  return {
    os: platform === "darwin" ? `macOS ${await sh("sw_vers", ["-productVersion"])}`.trim() : `${platform} ${os.release()}`,
    arch: os.arch(),
    cpu,
    cores: cpus.length,
    perfCores,
    ramGB,
    freeRamGB: os.freemem() / GB,
    unified,
    gpus,
    diskFreeGB,
    modelMemoryGB,
    bandwidthGBs,
    acceleration: unified ? "metal" : vram > 0 ? "cuda" : "cpu",
  };
}

// ---------------------------------------------------------------- catalogue

export type Use = "general" | "code" | "reasoning" | "vision" | "light" | "embedding";
export type CatalogModel = {
  name: string;
  family: string;
  params: number; // billions of parameters (active ones for mixture-of-experts)
  totalParams?: number; // MoE: all parameters, which must fit in memory
  sizeGB: number; // download size at the default quantisation (≈ weights in memory)
  uses: Use[];
  tools?: boolean;
  thinking?: boolean;
  vision?: boolean;
  note: string;
};

/** Popular Ollama models, default (≈ Q4) quantisation. Sizes are approximate. */
export const CATALOG: CatalogModel[] = [
  { name: "qwen3:1.7b", family: "Qwen3", params: 1.7, sizeGB: 1.4, uses: ["light"], tools: true, thinking: true, note: "Très rapide, pour les tâches simples et le tri" },
  { name: "qwen3:4b", family: "Qwen3", params: 4, sizeGB: 2.6, uses: ["light", "general"], tools: true, thinking: true, note: "Bon compromis pour les petites machines" },
  { name: "qwen3:8b", family: "Qwen3", params: 8, sizeGB: 5.2, uses: ["general", "reasoning"], tools: true, thinking: true, note: "Polyvalent, outils et raisonnement : la référence sur 16 Go" },
  { name: "qwen3:14b", family: "Qwen3", params: 14, sizeGB: 9.3, uses: ["general", "reasoning", "code"], tools: true, thinking: true, note: "Nettement meilleur en planification, demande 24 Go+" },
  { name: "qwen3:30b", family: "Qwen3 MoE", params: 3, totalParams: 30, sizeGB: 19, uses: ["general", "reasoning"], tools: true, thinking: true, note: "MoE : qualité d'un gros modèle, vitesse d'un 3B" },
  { name: "qwen3:32b", family: "Qwen3", params: 32, sizeGB: 20, uses: ["general", "reasoning", "code"], tools: true, thinking: true, note: "Haut de gamme dense, pour 48 Go+" },
  { name: "llama3.2:3b", family: "Llama 3.2", params: 3, sizeGB: 2.0, uses: ["light"], tools: true, note: "Léger et rapide, bon en anglais" },
  { name: "llama3.1:8b", family: "Llama 3.1", params: 8, sizeGB: 4.9, uses: ["general"], tools: true, note: "Généraliste solide, appels d'outils fiables" },
  { name: "gemma3:4b", family: "Gemma 3", params: 4, sizeGB: 3.3, uses: ["light", "vision"], vision: true, note: "Petit modèle qui comprend les images" },
  { name: "gemma3:12b", family: "Gemma 3", params: 12, sizeGB: 8.1, uses: ["general", "vision"], vision: true, note: "Rédaction de qualité et vision, sans outils" },
  { name: "gemma3:27b", family: "Gemma 3", params: 27, sizeGB: 17, uses: ["general", "vision"], vision: true, note: "Très bon rédacteur multilingue, pour 32 Go+" },
  { name: "mistral-small3.2:24b", family: "Mistral Small", params: 24, sizeGB: 15, uses: ["general", "vision"], tools: true, vision: true, note: "Excellent en français, outils et vision" },
  { name: "gpt-oss:20b", family: "gpt-oss", params: 3.6, totalParams: 21, sizeGB: 14, uses: ["general", "reasoning"], tools: true, thinking: true, note: "MoE d'OpenAI, raisonnement et outils" },
  { name: "phi4-mini:3.8b", family: "Phi-4", params: 3.8, sizeGB: 2.5, uses: ["light"], tools: true, note: "Compact, bon en raisonnement simple" },
  { name: "phi4:14b", family: "Phi-4", params: 14, sizeGB: 9.1, uses: ["reasoning"], note: "Raisonnement et maths, sans outils" },
  { name: "deepseek-r1:8b", family: "DeepSeek-R1", params: 8, sizeGB: 5.2, uses: ["reasoning"], thinking: true, note: "Raisonnement pas à pas, sans outils" },
  { name: "deepseek-r1:14b", family: "DeepSeek-R1", params: 14, sizeGB: 9.0, uses: ["reasoning"], thinking: true, note: "Raisonnement plus poussé, sans outils" },
  { name: "qwen2.5-coder:7b", family: "Qwen2.5-Coder", params: 7, sizeGB: 4.7, uses: ["code"], tools: true, note: "Spécialiste du code, rapide" },
  { name: "qwen2.5-coder:14b", family: "Qwen2.5-Coder", params: 14, sizeGB: 9.0, uses: ["code"], tools: true, note: "Code de meilleure qualité, 24 Go+" },
  { name: "qwen2.5-coder:32b", family: "Qwen2.5-Coder", params: 32, sizeGB: 20, uses: ["code"], tools: true, note: "Le meilleur codeur local, 48 Go+" },
  { name: "qwen2.5vl:7b", family: "Qwen2.5-VL", params: 7, sizeGB: 6.0, uses: ["vision"], vision: true, note: "Lecture de documents et d'images" },
  { name: "qwen3-embedding:0.6b", family: "Qwen3 Embedding", params: 0.6, sizeGB: 0.64, uses: ["embedding"], note: "Embeddings multilingues légers" },
  { name: "qwen3-embedding:4b", family: "Qwen3 Embedding", params: 4, sizeGB: 2.5, uses: ["embedding"], note: "Embeddings multilingues de haute qualité" },
  { name: "bge-m3", family: "BGE-M3", params: 0.57, sizeGB: 1.2, uses: ["embedding"], note: "Embeddings multilingues, longs documents" },
  { name: "nomic-embed-text", family: "Nomic", params: 0.14, sizeGB: 0.27, uses: ["embedding"], note: "Très léger, surtout anglais" },
];

export type Fit = "smooth" | "tight" | "too_big";
export type Assessment = CatalogModel & { needGB: number; fit: Fit; tokensPerSec?: number; installed: boolean };

/** Memory needed at runtime: weights + runtime overhead + KV cache for the context. */
export function memoryNeeded(m: CatalogModel, numCtx: number) {
  if (m.uses.includes("embedding")) return m.sizeGB * 1.2 + 0.2;
  const kvAt16k = 0.5 + 0.15 * (m.totalParams ? Math.min(m.totalParams, 32) * 0.5 : m.params);
  return m.sizeGB * 1.1 + 0.4 + kvAt16k * (numCtx / 16384);
}

export function assess(hw: Hardware, numCtx: number, installed: string[]): Assessment[] {
  const have = new Set(installed.map((n) => n.replace(/:latest$/, "")));
  return CATALOG.map((m) => {
    const needGB = memoryNeeded(m, numCtx);
    const fit: Fit = needGB <= hw.modelMemoryGB * 0.85 ? "smooth" : needGB <= hw.modelMemoryGB ? "tight" : "too_big";
    // Each generated token reads the active weights once: speed ≈ bandwidth / active size (×0.6 for real-world efficiency).
    const activeGB = m.totalParams ? m.sizeGB * (m.params / m.totalParams) : m.sizeGB;
    const tokensPerSec = m.uses.includes("embedding") ? undefined : Math.round((hw.bandwidthGBs / Math.max(0.3, activeGB)) * 0.6);
    return { ...m, needGB: Math.round(needGB * 10) / 10, fit, tokensPerSec, installed: have.has(m.name.replace(/:latest$/, "")) };
  });
}

/** For each use: the best model that runs smoothly (largest, tools preferred for agents), a lighter one and a more ambitious one. */
export function recommend(list: Assessment[]) {
  const uses: Use[] = ["general", "code", "reasoning", "vision", "light", "embedding"];
  const quality = (m: Assessment) => (m.totalParams ?? m.params) + (m.tools ? 2 : 0);
  return uses.map((use) => {
    const forUse = list.filter((m) => m.uses.includes(use));
    const smooth = forUse.filter((m) => m.fit === "smooth").sort((a, b) => quality(b) - quality(a));
    const best = smooth[0];
    const lighter = smooth.filter((m) => m !== best).sort((a, b) => (b.tokensPerSec ?? 0) - (a.tokensPerSec ?? 0))[0];
    const ambitious = forUse.filter((m) => m.fit === "tight").sort((a, b) => quality(b) - quality(a))[0];
    return { use, best: best?.name, lighter: lighter?.name, ambitious: ambitious?.name };
  });
}
