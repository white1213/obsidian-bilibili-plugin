export interface VideoPage {
	cid: number;
	page: number;
	part: string;
	duration: number;
}

export interface VideoInfo {
	bvid: string;
	title: string;
	pic: string;
	duration: number;
	up: string;
	pages: VideoPage[];
}

export interface DashStream {
	id: number;
	codecid: number;
	codecs: string;
	bandwidth: number;
	baseUrl: string;
	/** 备用 CDN 地址：base_url 常被分配到 PCDN 边缘节点（易 403），需依次回退 */
	backupUrls: string[];
}

export interface DashInfo {
	quality: number;
	timelength: number;
	video: DashStream[];
	audio: DashStream[];
}

export interface BiliCreds {
	sessdata: string;
	biliJct: string;
	dedeuserid: string;
	buvid3: string;
	buvid4: string;
}
