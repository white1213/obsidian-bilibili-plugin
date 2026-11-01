import esbuild from "esbuild";
import process from "process";
import builtins from "builtin-modules";

const mode = process.argv[2] || "dev";

if (mode === "page") {
	// 测试页打包（浏览器 IIFE，供 proxy-server 使用）
	await esbuild.build({
		entryPoints: ["test/testpage/main.ts"],
		bundle: true,
		external: [...builtins],
		format: "iife",
		target: "es2020",
		logLevel: "info",
		outfile: "test/build/engine.js",
	});
} else if (mode === "test") {
	// API 链路测试脚本（node ESM）
	await esbuild.build({
		entryPoints: ["test/api-test.ts"],
		bundle: true,
		platform: "node",
		format: "esm",
		target: "node18",
		logLevel: "info",
		outfile: "test/build/api-test.mjs",
	});
} else {
	await esbuild.build({
		entryPoints: ["src/main.ts"],
		bundle: true,
		external: ["obsidian", "electron", ...builtins],
		format: "cjs",
		target: "es2018",
		logLevel: "info",
		sourcemap: mode !== "build" ? "inline" : false,
		treeShaking: true,
		outfile: "main.js",
		minify: mode === "build",
	});
}
