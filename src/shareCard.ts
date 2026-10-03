import { localizeItemName, localizeSetOrGrace } from "./localization";
import type { AttributeKey, SaveSnapshot } from "./types";
import type { SavedBuild } from "./buildLibrary";
import { orderedShareEquipment, SHARE_ATTRIBUTES, SHARE_SLOTS } from './shareSummary';

export interface ShareCardData {
  title: string;
  level: number;
  attributes: Array<{ name: string; value: number }>;
  graces: Array<{ name: string; count: number }>;
  equipment: Array<{ slot: string; name: string; plus: number; grace: string }>;
}

export function buildShareCardData(snapshot: SaveSnapshot): ShareCardData {
  const graceCounts = new Map<string, number>();
  for (const item of snapshot.currentLoadout) {
    if (!item.setOrGrace || item.setOrGrace === '-') continue;
    const grace = localizeSetOrGrace(item.setOrGrace);
    graceCounts.set(grace, (graceCounts.get(grace) ?? 0) + 1);
  }
  return {
    title: snapshot.currentLoadoutName ?? "当前装备",
    level: snapshot.character.level,
    attributes: Object.entries(SHARE_ATTRIBUTES).map(([key, name]) => ({ name, value: snapshot.character.attributes[key as AttributeKey] })),
    graces: [...graceCounts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    equipment: orderedShareEquipment(snapshot.currentLoadout).map((item) => ({
      slot: SHARE_SLOTS[item.slot] ?? "未知部位",
      name: localizeItemName(item.id, item.nameZh),
      plus: item.plus,
      grace: localizeSetOrGrace(item.setOrGrace),
    })),
  };
}

export function buildSavedBuildShareCardData(build: SavedBuild): ShareCardData {
  const graceCounts = new Map<string, number>();
  for (const item of build.equipment) {
    if (!item.setOrGrace || item.setOrGrace === '-') continue;
    const grace = localizeSetOrGrace(item.setOrGrace);
    graceCounts.set(grace, (graceCounts.get(grace) ?? 0) + 1);
  }
  return {
    title: build.title,
    level: build.level,
    attributes: Object.entries(SHARE_ATTRIBUTES).map(([key, name]) => ({ name, value: build.attributes[key as AttributeKey] })),
    graces: [...graceCounts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    equipment: orderedShareEquipment(build.equipment).map((item) => ({
      slot: SHARE_SLOTS[item.slot] ?? "未知部位",
      name: localizeItemName(item.id, item.nameZh),
      plus: item.plus,
      grace: localizeSetOrGrace(item.setOrGrace),
    })),
  };
}

export function createShareCardBlob(snapshot: SaveSnapshot): Promise<Blob> {
  return createShareCardBlobFromData(buildShareCardData(snapshot));
}

export function createSavedBuildShareCardBlob(build: SavedBuild): Promise<Blob> {
  return createShareCardBlobFromData(buildSavedBuildShareCardData(build));
}

/** Ellipsis is measured in the active font, not a guessed character count. */
export function fitShareText(context: Pick<CanvasRenderingContext2D, 'measureText'>, value: string, width: number): string {
  if (context.measureText(value).width <= width) return value;
  if (context.measureText('…').width > width) return '';
  const chars = Array.from(value);
  let low = 0, high = chars.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (context.measureText(chars.slice(0, middle).join('') + '…').width <= width) low = middle;
    else high = middle - 1;
  }
  return chars.slice(0, low).join('') + '…';
}

export function createShareCardBlobFromData(data: ShareCardData): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = 1080;
  canvas.height = Math.max(1350, 700 + data.equipment.length * 61);
  const context = canvas.getContext("2d");
  if (!context) return Promise.reject(new Error("浏览器不支持画布。"));

  context.fillStyle = "#090a0a";
  context.fillRect(0, 0, canvas.width, canvas.height);
  const gradient = context.createRadialGradient(80, 80, 0, 80, 80, 720);
  gradient.addColorStop(0, "rgba(183,51,34,.2)");
  gradient.addColorStop(1, "rgba(9,10,10,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);

  context.strokeStyle = "#594b31";
  context.lineWidth = 2;
  context.strokeRect(48, 48, 984, canvas.height - 96);
  context.fillStyle = "#b73322";
  context.font = '700 36px Georgia, serif';
  context.textAlign = "center";
  context.fillText("Nioh", 116, 130);

  context.textAlign = "left";
  context.fillStyle = "#bda263";
  context.font = '24px "Microsoft YaHei", sans-serif';
  context.fillText("Nioh 2 · 随身配装档案", 184, 91);
  context.fillStyle = "#eee8d8";
  context.font = '600 58px "Microsoft YaHei", sans-serif';
  context.fillText(fitShareText(context, data.title, 580), 184, 151);
  context.textAlign = "right";
  context.fillStyle = "#b73322";
  context.font = '700 72px "Microsoft YaHei", sans-serif';
  context.fillText(String(data.level), 986, 142, 190);
  context.fillStyle = "#8d928e";
  context.font = '20px "Microsoft YaHei", sans-serif';
  context.fillText("等级", 986, 78);

  context.textAlign = "left";
  context.fillStyle = "#8d928e";
  context.font = '20px "Microsoft YaHei", sans-serif';
  context.fillText("八项能力", 72, 222);
  data.attributes.forEach((attribute, index) => {
    const x = 72 + index * 117;
    context.fillStyle = "#161918";
    context.fillRect(x, 244, 96, 92);
    context.fillStyle = "#bda263";
    context.font = '20px "Microsoft YaHei", sans-serif';
    context.fillText(attribute.name, x + 14, 275);
    context.fillStyle = "#eee8d8";
    context.font = '600 29px "Microsoft YaHei", sans-serif';
    context.fillText(String(attribute.value), x + 14, 316, 72);
  });

  context.fillStyle = "#8d928e";
  context.font = '20px "Microsoft YaHei", sans-serif';
  context.fillText("装备构成 · 件数不代表套装触发档位", 72, 390);
  for (const [index, grace] of data.graces.slice(0, 4).entries()) {
    const label = `${grace.name}  ${grace.count} 件`;
    const graceX = 72 + index % 2 * 474;
    const graceY = 408 + Math.floor(index / 2) * 60;
    context.font = '22px "Microsoft YaHei", sans-serif';
    context.strokeStyle = "#594b31";
    context.strokeRect(graceX, graceY, 462, 48);
    context.fillStyle = "#d5c395";
    context.fillText(fitShareText(context, label, 426), graceX + 18, graceY + 32);
  }

  context.fillStyle = "#8d928e";
  context.font = '20px "Microsoft YaHei", sans-serif';
  context.fillText("装备摘要 · 完整词条请分享文字资料", 72, 560);
  data.equipment.forEach((item, index) => {
    const y = 580 + index * 61;
    context.strokeStyle = "#262b29";
    context.beginPath();
    context.moveTo(72, y + 48);
    context.lineTo(1008, y + 48);
    context.stroke();
    context.fillStyle = "#bda263";
    context.font = '18px "Microsoft YaHei", sans-serif';
    context.fillText(fitShareText(context, item.slot, 94), 72, y + 30);
    context.fillStyle = "#eee8d8";
    context.font = '500 23px "Microsoft YaHei", sans-serif';
    context.fillText(fitShareText(context, item.name, 438), 182, y + 30);
    context.textAlign = "right";
    context.fillStyle = "#b73322";
    context.fillText(`+${item.plus}`, 1008, y + 30, 98);
    context.fillStyle = "#777e79";
    context.font = '17px "Microsoft YaHei", sans-serif';
    context.fillText(fitShareText(context, item.grace, 250), 900, y + 30);
    context.textAlign = "left";
  });

  context.fillStyle = "#777e79";
  context.font = '18px "Microsoft YaHei", sans-serif';
  context.fillText("Nioh 存档伴侣 · 佩戴绘卷尚未识别 · 不含存档文件与哈希", 72, canvas.height - 66);
  context.textAlign = "right";
  context.fillStyle = "#b73322";
  context.font = '700 24px "Microsoft YaHei", sans-serif';
  context.fillText("配装摘要", 1008, canvas.height - 66);

  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("构筑卡生成失败。")), "image/png"));
}
