import { App, Modal, Notice, PluginSettingTab, Setting } from 'obsidian';
import type BilibiliPlugin from './main';
import * as QRCode from 'qrcode';

export interface BilibiliSettings {
	quality: number;
	sessdata: string;
	biliJct: string;
	dedeuserid: string;
	buvid3: string;
	buvid4: string;
}

export const DEFAULT_SETTINGS: BilibiliSettings = {
	quality: 80,
	sessdata: '',
	biliJct: '',
	dedeuserid: '',
	buvid3: '',
	buvid4: '',
};

export class BilibiliSettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: BilibiliPlugin) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.createEl('h2', { text: 'Bilibili Player 设置' });

		const loginSetting = new Setting(containerEl)
			.setName('B站账号')
			.setDesc('扫码登录后自动保存 Cookie；1080p 需要登录。Cookie 过期后重新扫码即可。');
		const statusSpan = loginSetting.controlEl.createSpan({ text: '检查中…' });
		statusSpan.style.marginRight = '8px';
		this.plugin.api
			.getUsername()
			.then((n) => statusSpan.setText(n ? `已登录：${n}` : '未登录'))
			.catch(() => statusSpan.setText('状态获取失败'));
		loginSetting.addButton((b) =>
			b.setButtonText('扫码登录').onClick(() => {
				new QrLoginModal(this.app, this.plugin).open();
			}),
		);

		new Setting(containerEl)
			.setName('手动粘贴 SESSDATA（兜底）')
			.setDesc('扫码不可用时，从浏览器 F12 → Application → Cookies → bilibili.com 复制 SESSDATA 的值')
			.addText((t) => {
				t.inputEl.type = 'password';
				t.setValue(this.plugin.settings.sessdata).onChange(async (v) => {
					this.plugin.settings.sessdata = v.trim();
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName('清晰度')
			.setDesc('登录普通账号最高 1080p')
			.addDropdown((d) =>
				d
					.addOptions({ 80: '1080p', 64: '720p', 32: '480p', 16: '360p' })
					.setValue(String(this.plugin.settings.quality))
					.onChange(async (v) => {
						this.plugin.settings.quality = Number(v) || 80;
						await this.plugin.saveSettings();
					}),
			);
	}
}

class QrLoginModal extends Modal {
	private key = '';
	private timer = 0;
	private closed = false;

	constructor(app: App, private plugin: BilibiliPlugin) {
		super(app);
	}

	async onOpen(): Promise<void> {
		this.contentEl.createEl('h3', { text: 'B站扫码登录' });
		this.contentEl.createEl('p', { text: '用手机B站App「扫一扫」扫描下面的二维码。' });
		const imgWrap = this.contentEl.createDiv({ cls: 'bili-qr-wrap' });
		const status = this.contentEl.createEl('p', { text: '生成二维码中…' });
		try {
			const gen = await this.plugin.api.qrGenerate();
			this.key = gen.qrcodeKey;
			const dataUrl = await QRCode.toDataURL(gen.qrurl, { width: 220, margin: 1 });
			const img = imgWrap.createEl('img');
			img.src = dataUrl;
			img.style.width = '220px';
			img.style.borderRadius = '8px';
			status.setText('等待扫码…');
			this.timer = window.setInterval(async () => {
				if (this.closed || !this.key) return;
				try {
					const r = await this.plugin.api.qrPoll(this.key);
					if (r.code === 0 && r.cookies) {
						this.stop();
						const s = this.plugin.settings;
						s.sessdata = r.cookies.sessdata;
						s.biliJct = r.cookies.biliJct;
						s.dedeuserid = r.cookies.dedeuserid;
						try {
							await this.plugin.api.ensureBuvid();
						} catch {}
						await this.plugin.saveSettings();
						status.setText('✅ 登录成功');
						new Notice('B站登录成功');
						setTimeout(() => {
							if (!this.closed) this.close();
						}, 800);
					} else if (r.code === 86090) {
						status.setText('已扫码，请在手机上确认…');
					} else if (r.code === 86038) {
						this.stop();
						status.setText('二维码已过期，请关闭后重新打开');
					}
				} catch {
					// 网络抖动忽略，下轮再试
				}
			}, 1500);
		} catch (e) {
			status.setText('生成二维码失败：' + (e instanceof Error ? e.message : String(e)));
		}
	}

	private stop(): void {
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = 0;
		}
	}

	onClose(): void {
		this.closed = true;
		this.stop();
	}
}
