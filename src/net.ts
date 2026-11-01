/** 与运行环境无关的传输层接口：插件里用 requestUrl 实现，测试页用 fetch 代理实现 */
export interface TransportResponse {
	status: number;
	data: ArrayBuffer;
	text: string;
}

export interface HttpTransport {
	get(url: string, headers?: Record<string, string>): Promise<TransportResponse>;
}
