/** 与运行环境无关的传输层接口：插件里用 requestUrl 实现，测试页用 fetch 代理实现 */
export interface TransportResponse {
	status: number;
	data: ArrayBuffer;
	text: string;
	/** 响应头；set-cookie 多条时用 \n 拼接存放在 'set-cookie' 键 */
	headers?: Record<string, string>;
}

export interface HttpTransport {
	get(url: string, headers?: Record<string, string>): Promise<TransportResponse>;
}
