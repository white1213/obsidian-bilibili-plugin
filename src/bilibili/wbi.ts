/** WBI 签名：mixin key 置换表（来自 bilibili-API-collect 社区文档） */
const MIXIN_KEY_ENC_TAB = [
	46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
	33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40,
	61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11,
	36, 20, 34, 44, 52,
];

export function getMixinKey(imgKey: string, subKey: string): string {
	const raw = imgKey + subKey;
	let out = '';
	for (const i of MIXIN_KEY_ENC_TAB) out += raw[i] ?? '';
	return out.slice(0, 32);
}
