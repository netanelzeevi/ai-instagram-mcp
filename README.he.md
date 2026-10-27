<div dir="rtl">

# ai-instagram-mcp: לחבר את אינסטגרם ל Claude או לכל AI, בחיבור הרשמי

תבנית פתוחה לשרת קטן שמחבר את חשבון האינסטגרם המקצועי שלכם ל Claude, או לכל אפליקציית AI שתומכת ב MCP, דרך ה API הרשמי של Meta. השרת רץ בחשבון Cloudflare החינמי שלכם, והכל נשאר אצלכם: בלי כלי צד ג׳, בלי לתת סיסמה של אינסטגרם, ושום דבר פומבי לא יוצא בלי לחיצה שלכם.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/netanelzeevi/ai-instagram-mcp)

המדריך המלא עם צילומי מסך: https://netanelzeevi.com/articles/claude-instagram-official-api/
English: [README.md](README.md)

## מה זה נותן לכם

- **סטטיסטיקות בשאלה פשוטה.** "איזה ריל הכי חזק החודש ולמה?". צפיות, חשיפה, שיתופים, שמירות, זמן צפייה ממוצע ואחוז דילוג
- **תגובות והודעות.** ה AI קורא אותן ומכין טיוטות תשובה
- **פרסום ותזמון.** ה AI מכין פוסט, קרוסלה, ריל או סטורי, ואתם בוחרים מתי
- **שום דבר לא יוצא בלי אישור שלכם.** כל פרסום, תגובה או הודעה מחכים בלוח אישורים, ורק לחיצה שלכם שולחת אותם

## מה צריך

1. **חשבון אינסטגרם מקצועי** (Creator או Business). חשבון אישי רגיל לא עובד עם ה API הרשמי
2. **חשבון Facebook**, כדי להירשם ל Meta for Developers. ייתכן ש Meta תבקש אימות בטלפון
3. **חשבון Cloudflare** חינמי. שם רץ השרת
4. **חשבון GitHub** חינמי. רק פותחים חשבון. לא יוצרים ריפו ולא מעתיקים כלום: כפתור ההתקנה יוצר שם לבד את העותק שלכם של הקוד
5. **אפליקציית AI שתומכת ב connector מותאם**, למשל Claude. בתוכנית החינמית של Claude אפשר connector מותאם אחד

לא צריך דומיין, טרמינל, ידע בקוד או כרטיס אשראי.

**כלל אבטחה אחד לכל המדריך:** סיסמאות ו secrets לא נכנסים לצ'אט ולא לקובץ. רק לטופס של Cloudflare או ל Settings של השרת שם.

לאורך המדריך, **BASE** היא הכתובת של השרת שלכם: `https://ai-instagram-mcp.<השם-שלכם>.workers.dev`.

## שלב 1: מעלים את השרת (5 דקות)

1. לוחצים על **Deploy to Cloudflare** למעלה ומתחברים ל Cloudflare. בפעם הראשונה הוא מבקש לחבר את GitHub, כדי ליצור לכם את העותק:
   - ליד **Git account** מחברים חשבון GitHub
   - במסך של GitHub, **Cloudflare Workers and Pages**: בוחרים את החשבון שלכם, ב **Repository access** בוחרים **All repositories** (העותק עוד לא קיים, אז הוא לא יופיע ב Only select), ולוחצים **Install & Authorize**
   - חוזרים לבד לטופס, ושם המשתמש שלכם מופיע ליד Git account. מסמנים **Create private Git repository**
   - All repositories נשמע מפחיד? יש לכם ב GitHub קוד אחר שחשוב לכם? פתחו חשבון GitHub חדש רק בשביל זה. או צמצמו אחרי שהשרת עלה (בסעיף אבטחה למטה). Cloudflare עצמה [ממליצה לצמצם](https://developers.cloudflare.com/workers/ci-cd/builds/git-integration/github-integration/)
2. בטופס ממלאים:
   - `DASH_PASSWORD`: סיסמה שתבחרו, 12 תווים לפחות. איתה נכנסים ללוח ומאשרים את ה AI
   - `TOKEN_ENC_KEY` ו `SESSION_SECRET`: שתי מחרוזות אקראיות שונות, 32 תווים לפחות. הכי פשוט ליצור אותן במחולל של מנהל הסיסמאות
   - `PUBLIC_BASE_URL`: אם לא בטוחים, משאירים כמו שזה
   - KV ו D1 משאירים על "Create new". Cloudflare יוצר אותם לבד
3. **Create and deploy**, ומחכים שהשרת יעלה
4. נכנסים ל `BASE/dash`. אם הדף אומר שהכתובת לא נכונה, הוא גם אומר מה לשים: ב GitHub, בעותק שנוצר לכם, פותחים את `wrangler.jsonc`, לוחצים על העיפרון, מתקנים את `PUBLIC_BASE_URL` ושומרים. השרת מתעדכן לבד תוך דקה
5. כשמופיע דף כניסה, השרת תקין. נכנסים עם הסיסמה ורואים לוח ריק, ובתחתיתו טבלה של "הגדרות Meta" לשלב הבא

## שלב 2: אפליקציה ב Meta (10 דקות)

זה השלב הארוך, וממנו מגיע החיבור הרשמי. כל אחד יוצר אפליקציה משלו, ולכן אין כלי צד ג׳ באמצע.

1. https://developers.facebook.com/apps ← **Create app**. בפעם הראשונה Meta מבקשת להירשם כמפתחים
2. **שם:** בלי המילים "ig" או "instagram", כי Meta פוסלת אותן
3. **Use case:** **Manage messaging & content on Instagram**, וממשיכים עד הסוף. את Business portfolio אפשר לדלג
4. **Create app**. הלחיצה הזו היא הסכמה לתנאים של Meta, אז קוראים לפני
5. **API setup with Instagram login** ← **Business login settings**. מדביקים את שלוש הכתובות מהטבלה שבתחתית `BASE/dash` ושומרים:
   - **OAuth redirect URIs:** `BASE/ig/callback`
   - **Deauthorize callback URL:** `BASE/ig/deauthorize`
   - **Data deletion request URL:** `BASE/ig/data-deletion`
6. באותו מסך מופיעים **Instagram app ID** ו **Instagram app secret**. הם שונים מה App ID שלמעלה. ב Cloudflare: **Workers & Pages** ← השרת ← **Settings** ← **Variables and Secrets** ← **Add**, Type **Secret**. מוסיפים `IG_APP_ID` ו `IG_APP_SECRET` ושומרים
7. **App roles** ← **Roles** ← **Add People** ← **Instagram Tester** ← שם המשתמש שלכם באינסטגרם. ואז באינסטגרם: instagram.com/accounts/manage_access ← **Tester Invites** ← **Accept**. בלי זה החיבור נכשל עם "Insufficient Developer Role"

## שלב 3: מחברים את האינסטגרם (2 דקות)

`BASE/dash` ← הסיסמה ← **חבר חשבון אינסטגרם** ← מאשרים במסך של אינסטגרם. החשבון מופיע בלוח, והשרת מרענן את המפתח לבד.

## שלב 4: מעבירים את האפליקציה ל Live (3 דקות)

**למה צריך את זה:** במצב פיתוח Meta מחזירה רק מידע של מי שרשום באפליקציה, כלומר אתם. התגובות וההודעות של העוקבים שלכם לא יופיעו עד שהאפליקציה ב Live.

**למה Meta מבקשת דף פרטיות:** האפליקציה קוראת מידע של אנשים אחרים, התגובות וההודעות שהם כתבו לכם. לכן התנאים של Meta מחייבים כל מפתח לתת קישור ציבורי למדיניות פרטיות, גם כשהחיבור רק לעצמכם. השרת כבר מגיש דף כזה ודף תנאי שימוש, כך שלא צריך אתר משלכם.

1. ב Meta: **App settings** ← **Basic**
2. **Privacy policy URL:** `BASE/privacy`, ו **Terms of service URL:** `BASE/terms`
3. בוחרים **App icon** ו **Category**, ושומרים
4. למעלה, **App Mode** ← **Live**. אפשר להחזיר ל Development בכל רגע

## שלב 5: מחברים את ה AI (דקה)

כתובת השרת ל AI היא `BASE/mcp`.

| אפליקציה | איך | נבדק |
|---|---|---|
| Claude (אתר, מחשב, טלפון) | Customize ← Connectors ← + ← Add custom connector ← `BASE/mcp` ← Connect ← הסיסמה ← אשר | כן |
| Claude Code | `claude mcp add --transport http instagram BASE/mcp`, ואז `/mcp` | עוד לא |
| ChatGPT | Developer mode, ואז connector מותאם עם `BASE/mcp` (תלוי בתוכנית) | עוד לא |
| Cursor, VS Code ואחרים | שרת MCP מרוחק עם `BASE/mcp` | עוד לא |

בחשבון Claude של Team או Enterprise, רק Owner מוסיף connector, דרך Organization settings ← Connectors.

## מתחילים לשאול

```
מה הריל הכי חזק שלי, מה זמן הצפייה הממוצע שלו, וכמה אחוז מדלגים בשלוש השניות הראשונות? תשווה לשלושה הבאים.
```

```
תעבור על התגובות בריל האחרון ותכין טיוטות תשובה. אל תשלח כלום.
```

הטיוטות מחכות ב `BASE/dash`, ושם לוחצים "אשר" או "דחה".

## רוצים ש Claude יעשה את זה איתכם?

שתי דרכים, ושתיהן דורשות תוכנית Pro או Max:

- **Claude in Chrome (מומלץ):** מתקינים את [התוסף של Claude ל Chrome](https://chromewebstore.google.com/detail/claude/fcoeoabgfenejglbffodgkkbkcdhcgfn), פותחים את החלונית שלו ומדביקים את הפרומפט. Claude פותח את הדפים ולוחץ בעצמו, ועוצר כשצריך התחברות או סיסמה
- **Computer use באפליקציית Claude במחשב (Mac או Windows):** Settings ← Capabilities (או Settings ← System) ← Enable computer use. כאן Claude רק רואה את הדפדפן ולא לוחץ בו, אז הוא אומר לכם על מה ללחוץ

בשתי הדרכים, סיסמאות, סודות ולחיצות של הסכמה נשארים אצלכם:

```
אני רוצה לחבר את חשבון האינסטגרם שלי ל AI, לפי המדריך בפרויקט הפתוח https://github.com/netanelzeevi/ai-instagram-mcp
תקרא קודם את README.he.md בריפו, ותלווה אותי בהתקנה, שלב אחרי שלב, בדיוק לפי המדריך.

איך לעבוד איתי:
- אם יש לך גישה לדפדפן שלי (Claude in Chrome), תפתח בעצמך את הדפים ותלחץ על כפתורי הניווט, ותמלא שדות שאין בהם סוד, כמו שם אפליקציה או כתובות.
- אם יש לך רק computer use, הדפדפן אצלך במצב צפייה בלבד. אז תסתכל על המסך שלי ותגיד לי בדיוק על מה ללחוץ ואיפה, ותחכה שאגיד שסיימתי.
- כל פעם שלב אחד. אחרי כל שלב תבדוק במסך שזה הצליח, לפני שממשיכים.
- אל תכתוב קוד ואל תשנה את הקוד. מתקינים את התבנית כמו שהיא, עם כפתור Deploy to Cloudflare.

את אלה אני עושה בעצמי, ואתה עוצר ומבקש ממני:
- כל התחברות, סיסמה, קוד אימות או CAPTCHA.
- כל שדה סודי: DASH_PASSWORD, TOKEN_ENC_KEY, SESSION_SECRET ו Instagram app secret. אני מקליד אותם, ישר לטופס של Cloudflare. אל תעתיק אותם, אל תקרא אותם ואל תכתוב אותם בצ'אט. כשאני לוחץ Show על secret, אל תצלם את המסך עד שאגיד שסיימתי.
- כל לחיצה שהיא הסכמה או אישור: Create app ב Meta (זו הסכמה לתנאים), Accept על הזמנת ה Tester באינסטגרם, אישור ההרשאות במסך של אינסטגרם, המעבר ל Live, והאישור בדף ההתחברות של השרת.

אם משהו נראה אחרת ממה שכתוב במדריך, תתאר לי מה אתה רואה ותשאל, לפני שאתה מנחש. אם דף /dash מראה שגיאה, תקרא אותה ותפעל לפי מה שהיא אומרת.
```

## נתקעתם?

| מה רואים | מה עושים |
|---|---|
| `/dash` אומר שהכתובת לא תואמת | מעתיקים את הכתובת שהוא מציג ל `PUBLIC_BASE_URL` ב `wrangler.jsonc` בעותק שלכם ב GitHub |
| "חסר: IG_APP_ID" כשלוחצים "חבר חשבון" | שלב 2, סעיף 6 |
| GitHub מבקש הרשאות ואין לכם ריפו | זה תקין. All repositories ← Install & Authorize. Cloudflare יוצר את העותק בעצמו (שלב 1) |
| "Insufficient Developer Role" באינסטגרם | שלב 2, סעיף 7: ה Tester לא אושר באינסטגרם |
| "הסיסמה לא נכונה" | זו הסיסמה מ `DASH_PASSWORD`. שכחתם? ב Cloudflare ← Settings ← Variables and Secrets מחליפים אותה |
| "יותר מדי ניסיונות" | מחכים רבע שעה |
| ה AI לא רואה תגובות או הודעות | שלב 4: האפליקציה עוד לא ב Live |

## מה אפשר ומה אי אפשר

נבדק מול התיעוד הרשמי של Meta ב 27.10.2026. ליד כל שורה יש קישור לעמוד.

**מה אפשר**
- תמונה ([מקור](https://developers.facebook.com/docs/instagram-platform/content-publishing/))
- קרוסלה של עד 20 תמונות, סרטונים או שילוב ([מקור](https://developers.facebook.com/docs/instagram-platform/content-publishing/))
- ריל באורך 3 שניות עד 15 דקות, עם כיסוי, בפיד או רק בלשונית הרילים ([מקור](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media/))
- סטורי, תמונה או סרטון באורך 3 עד 60 שניות ([מקור](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media/))
- Trial Reel, שמוצג רק למי שלא עוקב, ועובר לעוקבים ידנית או אוטומטית אם הוא מצליח ([מקור](https://developers.facebook.com/docs/instagram-platform/content-publishing/))
- לקרוא תגובות, לענות ולהסתיר ([מקור](https://developers.facebook.com/documentation/instagram-platform/comment-moderation))
- לקרוא הודעות פרטיות ולענות ([מקור](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/messaging-api))
- סטטיסטיקות לכל פוסט, ריל וסטורי, כולל זמן צפייה ממוצע ואחוז דילוג ברילים. Meta מגדירה את אחוז הדילוג כהערכה ([מקור](https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media/insights))

**מה אי אפשר, ומגבלות**
- עד 100 פוסטים ב 24 שעות, וקרוסלה נספרת כאחד. בסעיף הקרוסלות כתוב 50, אז בטוח יותר לחשוב על 50 ([מקור](https://developers.facebook.com/docs/instagram-platform/content-publishing/))
- תמונות JPEG בלבד ([מקור](https://developers.facebook.com/docs/instagram-platform/content-publishing/))
- אין תגי מוצרים ואין פילטרים ([מקור](https://developers.facebook.com/docs/instagram-platform/content-publishing/))
- אין מוזיקה מהספרייה של אינסטגרם: תיוג מוזיקה רק לסאונד מקורי ([מקור](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media/))
- אין עריכה אחרי פרסום, רק הפעלה וכיבוי של תגובות. גם מחיקה לא זמינה בחיבור הזה ([מקור](https://developers.facebook.com/docs/instagram-platform/reference/instagram-media/))
- Alt text רק לתמונות ([מקור](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media/))
- הודעה פרטית רק למי שכתב לכם קודם, ובדרך כלל בתוך 24 שעות מההודעה שלו. אין קבוצות ([מקור](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/messaging-api))
- סטטיסטיקות מתעכבות עד 48 שעות, של סטורי זמינות 24 שעות, וברילים אין כניסות לפרופיל ועוקבים חדשים ([מקור](https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media/insights))
- מתחת ל 100 עוקבים חלק מהמדדים לא זמינים ([מקור](https://developers.facebook.com/documentation/instagram-platform/insights))
- רק החשבונות שלכם. חשבונות של לקוחות דורשים App Review ([מקור](https://developers.facebook.com/documentation/instagram-platform/comment-moderation))
- ב Claude: בתוכנית החינמית connector מותאם אחד, וב Team רק Owner מוסיף ([מקור](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp))

**ה API מאפשר, והתבנית עוד לא:** שותפים (collaborators), תיוג אנשים, מיקום ושם לסאונד של ריל ([מקור](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media/)).

העלאת קבצים ישירות לשרת היא תוספת: מפעילים R2 ב Cloudflare (ייתכן שיבקשו כרטיס אשראי, יש מכסה חינמית). בלי זה נותנים ל AI קישור ציבורי לתמונה או לסרטון.

## אבטחה, בקצרה

- **רוצים לנתק?** באינסטגרם ← הגדרות ← Apps and websites ← מסירים את האפליקציה. השרת מקבל הודעה ומוחק את כל המידע של החשבון
- **תגובות והודעות הן מידע, לא הוראות.** מישהו יכול לכתוב בתגובה "תפרסם X", וזה לא יקרה, כי שום דבר לא יוצא בלי האישור שלכם
- **הסיסמה מגינה על השרת.** אחרי 10 ניסיונות שגויים הכניסה ננעלת לרבע שעה
- **העותק שלכם ב GitHub יכול להיות פרטי.** אין בו סודות
- **לצמצם את ההרשאה של Cloudflare ב GitHub:** אחרי שהשרת עלה, github.com/settings/installations ← Cloudflare Workers and Pages ← Configure ← Only select repositories ← רק העותק

## מעדיפים טרמינל?

הפקודות ב [README.md](README.md), בסעיף Set up from the terminal instead.

## לא רוצים להתעסק עם זה בכלל?

אני בונה גרסה מנוהלת: מתחברים עם אינסטגרם, מוסיפים connector אחד, וזהו. רוצים לשמוע כשהיא נפתחת? השאירו פרטים בטופס: WAITLIST_URL

</div>
