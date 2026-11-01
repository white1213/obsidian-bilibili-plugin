/** ISO-BMFF 盒子解析：只需顶层盒子表 + sidx（Segment Index），用于时间→字节偏移映射 */
export interface TopBox {
	type: string;
	start: number;
	size: number;
}

export function parseTopBoxes(buf: ArrayBuffer): TopBox[] {
	const view = new DataView(buf);
	const boxes: TopBox[] = [];
	let off = 0;
	while (off + 8 <= view.byteLength) {
		let size = view.getUint32(off);
		const type = String.fromCharCode(
			view.getUint8(off + 4),
			view.getUint8(off + 5),
			view.getUint8(off + 6),
			view.getUint8(off + 7),
		);
		let header = 8;
		if (size === 1) {
			if (off + 16 > view.byteLength) break;
			size = readU64(view, off + 8);
			header = 16;
		} else if (size === 0) {
			size = view.byteLength - off;
		}
		if (size < header || off + size > view.byteLength) break;
		boxes.push({ type, start: off, size });
		off += size;
	}
	return boxes;
}

export function readU64(view: DataView, off: number): number {
	const hi = view.getUint32(off);
	const lo = view.getUint32(off + 4);
	return hi * 4294967296 + lo;
}

export interface SidxInfo {
	timescale: number;
	earliest: number;
	firstOffset: number;
	refs: { size: number; duration: number }[];
	/** sidx 盒子结尾偏移（firstOffset 的锚点） */
	end: number;
}

export function parseSidx(buf: ArrayBuffer, box: TopBox): SidxInfo | null {
	const view = new DataView(buf, box.start, box.size);
	let p = 8; // 跳过 size+type
	const version = view.getUint8(p);
	p += 4; // version + flags
	p += 4; // reference_ID
	const timescale = view.getUint32(p);
	p += 4;
	let earliest: number;
	let firstOffset: number;
	if (version === 1) {
		earliest = readU64(view, p);
		p += 8;
		firstOffset = readU64(view, p);
		p += 8;
	} else {
		earliest = view.getUint32(p);
		p += 4;
		firstOffset = view.getUint32(p);
		p += 4;
	}
	p += 2; // reserved
	const count = view.getUint16(p);
	p += 2;
	const refs: { size: number; duration: number }[] = [];
	for (let i = 0; i < count && p + 12 <= box.size; i++) {
		const refU32 = view.getUint32(p);
		p += 4;
		const duration = view.getUint32(p);
		p += 4;
		p += 4; // sap flags
		refs.push({ size: refU32 & 0x7fffffff, duration });
	}
	if (!refs.length) return null;
	return { timescale, earliest, firstOffset, refs, end: box.start + box.size };
}
