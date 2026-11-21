import { OWNER_ID } from "../ranks.js";

export async function handlePhotoId(ctx, next) {
  if (ctx.chat?.type !== "private" || Number(ctx.from?.id) !== OWNER_ID) {
    return next();
  }

  const photo = ctx.message?.photo?.at(-1);
  if (!photo?.file_id) return next();

  await ctx.reply(`🆔 ID الصورة:\n\n<code>${photo.file_id}</code>`, {
    parse_mode: "HTML",
  });
}
