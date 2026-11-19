const HOME = "📋 <b>أوامر بوت نواف</b>\n\nاختر القسم الذي تريد معرفة أوامره:";
const back = (label, target) => [{ text: label, callback_data: target }];
const screens = {
  "cmdmenu:users": ["👤 <b>المستخدمين والرتب</b>\n\nاختر القسم:", [
    [{text:"🪪 أوامر المستخدمين",callback_data:"cmdmenu:users_info"},{text:"⬆️ رفع الرتب",callback_data:"cmdmenu:promote"}],
    [{text:"⬇️ تنزيل الرتب",callback_data:"cmdmenu:demote"}], back("↩️ رجوع","cmdmenu:home")
  ]],
  "cmdmenu:protection": ["🛡️ <b>الحماية</b>\n\nاختر نوع الأوامر:", [
    [{text:"🚫 الحظر والكتم",callback_data:"cmdmenu:moderation"},{text:"🔐 منع وسماح",callback_data:"cmdmenu:permissions"}],
    [{text:"🔒 قفل وفتح الأوامر",callback_data:"cmdmenu:locks"},{text:"🗑️ المسح",callback_data:"cmdmenu:delete"}],
    back("↩️ رجوع","cmdmenu:home")
  ]],
  "cmdmenu:games": ["🎮 <b>ألعاب البوت</b>\n\nاختر اللعبة التي تريد معرفة أوامرها:", [
    [{text:"🫣 غميضة",callback_data:"cmdmenu:hide"},{text:"⚽ بلنتيات",callback_data:"cmdmenu:penalties"}],
    [{text:"🤥 الكذاب",callback_data:"cmdmenu:liar"}],
    [{text:"🏃 سباق الكلمات",callback_data:"cmdmenu:word_race"},{text:"🖼️ توقع الصورة",callback_data:"cmdmenu:image_quiz"}],
    [{text:"⚡ أسرع كلمة",callback_data:"cmdmenu:speed_words"},{text:"🎌 الأنمي",callback_data:"cmdmenu:anime"}],
    back("↩️ رجوع","cmdmenu:home")
  ]],
};
const page = (title, body, backLabel="↩️ رجوع", target="cmdmenu:home") => [title+"\n\n"+body, [back(backLabel,target)]];
const detail = {
  "cmdmenu:users_info": page("🪪 <b>أوامر المستخدمين</b>","<b>ايدي</b>\nعرض آيدي حسابك.\n\n<b>رتبتي</b>\nعرض رتبتك في المجموعة.\n\n<b>رتبته</b>\nعرض رتبة شخص آخر.\n\n<b>كشف</b>\nعرض معلومات الشخص.\n\n<b>كشف المجموعة</b>\nعرض معلومات المجموعة.","↩️ رجوع للمستخدمين والرتب","cmdmenu:users"),
  "cmdmenu:promote": page("⬆️ <b>رفع الرتب</b>","<b>رفع مميز</b>\nرفع العضو إلى رتبة مميز.\n\n<b>رفع ادمن</b>\nرفع العضو إلى رتبة ادمن.\n\n<b>رفع ادمن اساسي</b>\nرفع العضو إلى رتبة ادمن اساسي.\n\n<b>رفع نائب المالك</b>\nرفع العضو إلى رتبة نائب المالك.\n\n<b>رفع المالك</b>\nرفع العضو إلى رتبة المالك.\n\n<b>رفع Dev</b>\nرفع العضو إلى رتبة Dev.","↩️ رجوع","cmdmenu:users"),
  "cmdmenu:demote": page("⬇️ <b>تنزيل الرتب</b>","<b>تنزيل مميز</b>\nتنزيل رتبة مميز.\n\n<b>تنزيل ادمن</b>\nتنزيل رتبة ادمن.\n\n<b>تنزيل ادمن اساسي</b>\nتنزيل رتبة ادمن اساسي.\n\n<b>تنزيل نائب المالك</b>\nتنزيل رتبة نائب المالك.\n\n<b>تنزيل المالك</b>\nتنزيل رتبة المالك.\n\n<b>تنزيل Dev</b>\nتنزيل رتبة Dev.","↩️ رجوع","cmdmenu:users"),
  "cmdmenu:moderation": page("🚫 <b>الحظر والكتم</b>","<b>حظر</b>\nحظر عضو بالرد على رسالته أو باستخدام الآيدي.\n\n<b>رفع الحظر</b>\nرفع الحظر عن عضو بالرد أو باستخدام الآيدي.\n\n<b>كتم</b>\nكتم عضو بالرد على رسالته أو باستخدام الآيدي.\n\n<b>رفع الكتم</b>\nرفع الكتم عن عضو بالرد أو باستخدام الآيدي.","↩️ رجوع للحماية","cmdmenu:protection"),
  "cmdmenu:permissions": page("🔐 <b>منع وسماح الأوامر</b>","<b>منع (اسم الأمر)</b>\nمنع استخدام أمر معين.\n\nمثال:\n<code>منع ايدي</code>\n\n<b>سماح (اسم الأمر)</b>\nالسماح باستخدام أمر تم منعه.\n\nمثال:\n<code>سماح ايدي</code>","↩️ رجوع للحماية","cmdmenu:protection"),
  "cmdmenu:locks": page("🔒 <b>قفل وفتح الأوامر</b>","<b>قفل امر (اسم الأمر)</b>\nقفل أمر معين في المجموعة.\n\nمثال:\n<code>قفل امر ايدي</code>\n\n<b>فتح امر (اسم الأمر)</b>\nفتح أمر تم قفله.\n\nمثال:\n<code>فتح امر ايدي</code>","↩️ رجوع للحماية","cmdmenu:protection"),
  "cmdmenu:delete": page("🗑️ <b>أوامر المسح</b>","<b>مسح</b>\nمسح الرسائل.\n\n<b>مسح 100</b>\nمسح العدد المحدد من الرسائل.","↩️ رجوع للحماية","cmdmenu:protection"),
  "cmdmenu:replies": page("💬 <b>الردود</b>","<b>اضف رد</b>\nإضافة رد جديد.\n\n<b>تعديل رد</b>\nتعديل رد موجود.\n\n<b>مسح رد</b>\nحذف رد.\n\n<b>الردود</b>\nعرض الردود المضافة.\n\n<b>مسح الردود</b>\nحذف جميع الردود."),
  "cmdmenu:special_replies": page("⭐ <b>الردود المميزة</b>","<b>اضف رد مميز</b>\nإضافة رد مميز.\n\n<b>تعديل رد مميز</b>\nتعديل رد مميز.\n\n<b>مسح رد مميز</b>\nحذف رد مميز.\n\n<b>الردود المميزة</b>\nعرض الردود المميزة.\n\n<b>مسح الردود المميزة</b>\nحذف جميع الردود المميزة."),
  "cmdmenu:admin": page("👮 <b>أوامر الإدارة</b>","<b>المطور</b>\nعرض معلومات المطور.\n\n<b>المالك</b>\nعرض معلومات المالك.\n\n<b>تغيير يوزر المطور</b>\nتغيير يوزر المطور.\n\n<b>تغيير يوزر المالك</b>\nتغيير يوزر المالك.\n\n<b>اضف ردي</b>\nإضافة ردك كأدمن.\n\n<b>حذف ردي</b>\nحذف ردك.\n\n<b>حذف رده</b>\nحذف رد أدمن.\n\n<b>/send</b>\nإرسال رسالة للمجموعات والقنوات من الخاص (للمالك الأساسي)، أو إرسال رسالة داخل القروب (للأدمن الأساسي وفوق).\n\n<b>ردود الادمن</b>\nعرض ردود الأدمن.\n\n<b>تفعيل ردود الادمن</b>\nتفعيل ردود الأدمن.\n\n<b>تعطيل ردود الادمن</b>\nتعطيل ردود الأدمن.\n\n<b>حذف ردود الادمن</b>\nحذف جميع ردود الأدمن."),
  "cmdmenu:custom": page("🧩 <b>الأوامر المضافة</b>","<b>اضف امر</b>\nإضافة أمر مخصص.\n\n<b>الاوامر المضافة</b>\nعرض الأوامر المضافة.\n\n<b>مسح امر</b>\nحذف أمر مضاف.\n\n<b>مسح الاوامر المضافة</b>\nحذف جميع الأوامر المضافة."),
  "cmdmenu:points": page("💰 <b>النقاط</b>","<b>نقاطي</b>\nعرض نقاطك.\n\n<b>توب</b>\nعرض المتصدرين بالنقاط."),
  "cmdmenu:whispers": page("🤫 <b>الهمسات</b>","<b>اهمس</b>\nإرسال همسة.\n\n<b>همسه</b>\nإرسال همسة.\n\n<b>همسة</b>\nإرسال همسة.\n\n<b>تفعيل الهمسات</b>\nتفعيل نظام الهمسات.\n\n<b>تعطيل الهمسات</b>\nتعطيل نظام الهمسات."),
  "cmdmenu:penalties": ["⚽ <b>لعبة البلنتيات</b>\n\nاختر ما تريد معرفته:", [[{text:"📖 الأوامر",callback_data:"cmdmenu:penalties_commands"},{text:"ℹ️ الشرح",callback_data:"cmdmenu:penalties_help"}],back("↩️ رجوع للألعاب","cmdmenu:games")]],
  "cmdmenu:penalties_commands": page("⚽ <b>أوامر البلنتيات</b>","<b>بلنتيات</b>\nبدء تجهيز لعبة البلنتيات.\n\n<b>دخول</b>\nالدخول إلى اللعبة.\n\n<b>.وزع</b>\nتوزيع اللاعبين.\n\n<b>.احمر رقم رقم</b>\nاختيار لاعبين للفريق الأحمر.\n\n<b>.ازرق رقم رقم</b>\nاختيار لاعبين للفريق الأزرق.\n\n<b>.ابدا</b>\nبدء الجولة.\n\n<b>.كمل</b>\nإكمال اللعبة.\n\n<b>انهاء بلنتيات</b>\nإنهاء اللعبة.","↩️ رجوع للبلنتيات","cmdmenu:penalties"),
  "cmdmenu:penalties_help": page("📖 <b>شرح البلنتيات</b>","لعبة جماعية تعتمد على توزيع اللاعبين على الفرق ثم تنفيذ جولات البلنتيات.\n\nيمكن الدخول إلى اللعبة ثم توزيع اللاعبين يدويًا أو تلقائيًا حسب نظام اللعبة.","↩️ رجوع للبلنتيات","cmdmenu:penalties"),
  "cmdmenu:hide": ["🫣 <b>لعبة الغميضة</b>\n\nاختر ما تريد معرفته:", [[{text:"📖 الأوامر",callback_data:"cmdmenu:hide_commands"}],back("↩️ رجوع للألعاب","cmdmenu:games")]],
  "cmdmenu:hide_commands": page("🫣 <b>أوامر الغميضة</b>","<b>غميضة</b>\nبدء تجهيز اللعبة.\n\n<b>دخول</b>\nالدخول إلى اللعبة.\n\n<b>ابدا</b>\nبدء اللعبة.\n\n<b>انهاء غميضة</b>\nإنهاء اللعبة.","↩️ رجوع للغميضة","cmdmenu:hide"),
  "cmdmenu:liar": ["🤥 <b>لعبة الكذاب</b>\n\nاختر ما تريد معرفته:", [[{text:"📖 الأوامر",callback_data:"cmdmenu:liar_commands"}],back("↩️ رجوع للألعاب","cmdmenu:games")]],
  "cmdmenu:liar_commands": page("🤥 <b>أوامر الكذاب</b>","<b>الكذاب</b>\nبدء تجهيز اللعبة.\n\n<b>دخول</b>\nالدخول إلى اللعبة.\n\n<b>.خروج</b>\nالخروج قبل بداية اللعبة.\n\n<b>.ابدا</b>\nبدء اللعبة.\n\n<b>.التصويت</b>\nبدء التصويت.\n\n<b>انهاء الكذاب</b>\nإنهاء اللعبة.","↩️ رجوع للكذاب","cmdmenu:liar"),
  "cmdmenu:word_race": ["🏃 <b>سباق الكلمات</b>\n\nاختر ما تريد معرفته:", [[{text:"📖 الأوامر",callback_data:"cmdmenu:word_race_commands"}],back("↩️ رجوع للألعاب","cmdmenu:games")]],
  "cmdmenu:word_race_commands": page("🏃 <b>أوامر سباق الكلمات</b>","<b>سباق الكلمات</b>\nبدء تجهيز اللعبة.\n\n<b>دخول</b>\nالدخول إلى اللعبة.\n\n<b>خروج</b>\nالخروج من اللعبة.\n\n<b>.الطور</b>\nاختيار طور اللعبة.\n\n<b>.وزع</b>\nتوزيع اللاعبين.\n\n<b>.اضافة احمر</b>\nإضافة لاعب للفريق الأحمر.\n\n<b>.اضافة ازرق</b>\nإضافة لاعب للفريق الأزرق.\n\n<b>.اضافة اخضر</b>\nإضافة لاعب للفريق الأخضر.\n\n<b>.اضافة اصفر</b>\nإضافة لاعب للفريق الأصفر.\n\n<b>.ابدا</b>\nبدء اللعبة.\n\n<b>.كمل</b>\nإكمال اللعبة.\n\n<b>انهاء سباق الكلمات</b>\nإنهاء اللعبة.","↩️ رجوع لسباق الكلمات","cmdmenu:word_race"),
  "cmdmenu:image_quiz": ["🖼️ <b>توقع الصورة</b>\n\nاختر ما تريد معرفته:", [[{text:"📖 الأوامر",callback_data:"cmdmenu:image_quiz_commands"}],back("↩️ رجوع للألعاب","cmdmenu:games")]],
  "cmdmenu:image_quiz_commands": page("🖼️ <b>أوامر توقع الصورة</b>","<b>توقع الصورة</b>\nبدء تجهيز اللعبة.\n\n<b>دخول</b>\nالدخول إلى اللعبة.\n\n<b>خروج</b>\nالخروج من اللعبة.\n\n<b>.اضافة</b>\nإضافة لاعب.\n\n<b>.اعدادات</b>\nفتح إعدادات اللعبة.\n\n<b>.ابدا</b>\nبدء اللعبة.\n\n<b>.كمل</b>\nإكمال اللعبة.\n\n<b>.انهاء</b>\nإنهاء اللعبة.","↩️ رجوع لتوقع الصورة","cmdmenu:image_quiz"),
  "cmdmenu:speed_words": page("⚡ <b>أسرع كلمة</b>","<b>كلمات</b>\nبدء لعبة أسرع كلمة.","↩️ رجوع للألعاب","cmdmenu:games"),
  "cmdmenu:anime": page("🎌 <b>لعبة الأنمي</b>","<b>انمي</b>\nبدء لعبة أسئلة الأنمي.","↩️ رجوع للألعاب","cmdmenu:games"),
  "cmdmenu:games_manager": page("⚙️ <b>إدارة الألعاب</b>","<b>اضف لعبة</b>\nإضافة لعبة جديدة.\n\n<b>الالعاب</b>\nعرض الألعاب الموجودة.\n\n<b>حذف لعبة اسم اللعبة</b>\nحذف لعبة.\n\n<b>تفعيل لعبة اسم اللعبة</b>\nتفعيل لعبة.\n\n<b>تعطيل لعبة اسم اللعبة</b>\nتعطيل لعبة.\n\n<b>تفعيل الالعاب</b>\nتفعيل جميع الألعاب.\n\n<b>تعطيل الالعاب</b>\nتعطيل جميع الألعاب."),
  "cmdmenu:colors": page("🎨 <b>ألوان الأزرار</b>","<b>تعديل لون</b>\nتغيير لون أزرار البوت.\n\nالألوان المتاحة:\n🔴 احمر\n🔵 ازرق\n🟢 اخضر\n⚪ شفاف"),
  "cmdmenu:developer": page("👨‍💻 <b>أوامر المطور</b>","<b>اوامر الادمن</b>\nعرض أوامر الإدارة.\n\n<b>اوامر المطور</b>\nعرض أوامر المطور.")
};
export async function handleCommandsMenuMessage(ctx) {
  const text = ctx.message?.text?.trim();
  if (text === "/help" || text === "/help@" + (ctx.me?.username || "").toLowerCase() || text === "الاوامر" || text === "اوامر البوت") {
    await ctx.reply(HOME, {parse_mode:"HTML",reply_markup:{inline_keyboard:[
      [{text:"👤 المستخدمين والرتب",callback_data:"cmdmenu:users"},{text:"🛡️ الحماية",callback_data:"cmdmenu:protection"}],
      [{text:"💬 الردود",callback_data:"cmdmenu:replies"},{text:"⭐ الردود المميزة",callback_data:"cmdmenu:special_replies"}],
      [{text:"👮 الإدارة",callback_data:"cmdmenu:admin"},{text:"🧩 الأوامر المضافة",callback_data:"cmdmenu:custom"}],
      [{text:"💰 النقاط",callback_data:"cmdmenu:points"},{text:"🤫 الهمسات",callback_data:"cmdmenu:whispers"}],
      [{text:"🎮 الألعاب",callback_data:"cmdmenu:games"},{text:"⚙️ إدارة الألعاب",callback_data:"cmdmenu:games_manager"}],
      [{text:"🎨 ألوان الأزرار",callback_data:"cmdmenu:colors"},{text:"👨‍💻 المطور",callback_data:"cmdmenu:developer"}]
    ]}});
    return true;
  }
  if (text === "شرح الالعاب" || text === "شرح الألعاب") {
    await ctx.reply("🎮 <b>شرح الألعاب</b>\n\nالألعاب القديمة مثل البلنتيات والغميضة والكذاب وسباق الكلمات وتوقع الصورة لم تُنقل إلى Node بعد. الألعاب المتاحة حاليًا تجدها في الميني آب.",{parse_mode:"HTML"});
    return true;
  }
  return false;
}
export async function handleCommandsMenuCallback(ctx) {
  const data = ctx.callbackQuery?.data;
  if (!data?.startsWith("cmdmenu:")) return false;
  await ctx.answerCallbackQuery();
  if (data === "cmdmenu:home") {
    const markup = {inline_keyboard:[
      [{text:"👤 المستخدمين والرتب",callback_data:"cmdmenu:users"},{text:"🛡️ الحماية",callback_data:"cmdmenu:protection"}],
      [{text:"💬 الردود",callback_data:"cmdmenu:replies"},{text:"⭐ الردود المميزة",callback_data:"cmdmenu:special_replies"}],
      [{text:"👮 الإدارة",callback_data:"cmdmenu:admin"},{text:"🧩 الأوامر المضافة",callback_data:"cmdmenu:custom"}],
      [{text:"💰 النقاط",callback_data:"cmdmenu:points"},{text:"🤫 الهمسات",callback_data:"cmdmenu:whispers"}],
      [{text:"🎮 الألعاب",callback_data:"cmdmenu:games"},{text:"⚙️ إدارة الألعاب",callback_data:"cmdmenu:games_manager"}],
      [{text:"🎨 ألوان الأزرار",callback_data:"cmdmenu:colors"},{text:"👨‍💻 المطور",callback_data:"cmdmenu:developer"}]
    ]};
    await ctx.editMessageText(HOME,{parse_mode:"HTML",reply_markup:markup});
    return true;
  }
  const item = screens[data] || detail[data];
  if (!item) return true;
  const [text, keyboard] = item;
  await ctx.editMessageText(text,{parse_mode:"HTML",reply_markup:{inline_keyboard:keyboard}});
  return true;
}
