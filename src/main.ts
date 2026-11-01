import { Plugin, requestUrl } from 'obsidian';
import { BilibiliClient } from './bilibili/api';
import { obsidianTransport } from './obsidian-transport';
import { BilibiliSettings, BilibiliSettingTab, DEFAULT_SETTINGS } from './settings';
import { EmbeddedPlayerRef, mountEmbedProcessor } from './player/embed';
import { DashPlayer } from './player/dash-stream';

export default class BilibiliPlugin extends Plugin {
	settings!: BilibiliSettings;
	api!: BilibiliClient;
	/** bvid → 当前打开的播放卡：时间戳链接命中时直接 seek */
	playersByBvid = new Map<string, EmbeddedPlayerRef>();

	async onload(): Promise<void> {
		await this.loadSettings();
		this.api = new BilibiliClient(
			obsidianTransport,
			() => ({
				sessdata: this.settings.sessdata,
				biliJct: this.settings.biliJct,
				dedeuserid: this.settings.dedeuserid,
				buvid3: this.settings.buvid3,
				buvid4: this.settings.buvid4,
			}),
			async (b3, b4) => {
				this.settings.buvid3 = b3;
				this.settings.buvid4 = b4;
				await this.saveSettings();
			},
		);
		this.addSettingTab(new BilibiliSettingTab(this.app, this));
		this.registerMarkdownPostProcessor(mountEmbedProcessor(this));
		// 调试钩子：CDP 控制台可直接驱动传输层与引擎定位问题（自用插件，保留）
		(window as any).__biliDebug = { transport: obsidianTransport, DashPlayer, api: this.api, requestUrl };
	}

	onunload(): void {
		for (const ref of this.playersByBvid.values()) {
			ref.destroyed = true;
			ref.destroy?.();
		}
		this.playersByBvid.clear();
	}

	private async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}
