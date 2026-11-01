/** 紧凑 MD5（仅用于 WBI 签名），输入按 UTF-8 编码，输出小写 hex */
function toUtf8Bytes(s: string): number[] {
	const out: number[] = [];
	for (let i = 0; i < s.length; i++) {
		let c = s.charCodeAt(i);
		if (c < 0x80) out.push(c);
		else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
		else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
			const c2 = s.charCodeAt(i + 1);
			if (c2 >= 0xdc00 && c2 <= 0xdfff) {
				c = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00);
				i++;
				out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
			} else {
				out.push(0xef, 0xbf, 0xbd);
			}
		} else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
	}
	return out;
}

const SHIFT = [
	7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
	5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
	4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
	6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];
const K = new Array<number>(64);
for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296);

export function md5(input: string): string {
	const msg = toUtf8Bytes(input);
	const bitLen = msg.length * 8;
	msg.push(0x80);
	while (msg.length % 64 !== 56) msg.push(0);
	for (let i = 0; i < 8; i++) msg.push((bitLen / Math.pow(2, i * 8)) & 0xff); // 消息长度远小于 2^32，够用

	let a0 = 0x67452301;
	let b0 = 0xefcdab89;
	let c0 = 0x98badcfe;
	let d0 = 0x10325476;

	const rotl = (x: number, c: number) => (x << c) | (x >>> (32 - c));

	for (let off = 0; off < msg.length; off += 64) {
		const M = new Array<number>(16);
		for (let i = 0; i < 16; i++) {
			M[i] =
				msg[off + i * 4] |
				(msg[off + i * 4 + 1] << 8) |
				(msg[off + i * 4 + 2] << 16) |
				(msg[off + i * 4 + 3] << 24);
		}
		let A = a0;
		let B = b0;
		let C = c0;
		let D = d0;
		for (let i = 0; i < 64; i++) {
			let F: number;
			let g: number;
			if (i < 16) {
				F = (B & C) | (~B & D);
				g = i;
			} else if (i < 32) {
				F = (D & B) | (~D & C);
				g = (5 * i + 1) % 16;
			} else if (i < 48) {
				F = B ^ C ^ D;
				g = (3 * i + 5) % 16;
			} else {
				F = C ^ (B | ~D);
				g = (7 * i) % 16;
			}
			F = (F + A + K[i] + M[g]) | 0;
			A = D;
			D = C;
			C = B;
			B = (B + rotl(F, SHIFT[i])) | 0;
		}
		a0 = (a0 + A) | 0;
		b0 = (b0 + B) | 0;
		c0 = (c0 + C) | 0;
		d0 = (d0 + D) | 0;
	}

	const hex = (n: number) => {
		let out = '';
		for (let i = 0; i < 4; i++) {
			out += ((n >>> (i * 8)) & 0xff).toString(16).padStart(2, '0');
		}
		return out;
	};
	return hex(a0) + hex(b0) + hex(c0) + hex(d0);
}
