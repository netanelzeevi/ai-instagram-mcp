<div dir="rtl">

# ai-instagram-mcp: לחבר את Claude לאינסטגרם בחיבור הרשמי

תבנית פתוחה לשרת MCP קטן, שמחבר את חשבון האינסטגרם המקצועי שלכם ל Claude, או לכל אפליקציית AI שתומכת ב MCP, דרך ה API הרשמי של Meta. העותק שלכם רץ בחשבון Cloudflare החינמי שלכם. בלי סיסמה ובלי תוסף, ושום דבר פומבי לא יוצא בלי לחיצה שלכם.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/netanelzeevi/ai-instagram-mcp)

המדריך המלא עם צילומי מסך: https://netanelzeevi.com/articles/claude-instagram-official-api/
English: [README.md](README.md)

## מה זה נותן לכם

- **סטטיסטיקות בשאלה פשוטה.** "איזה ריל הכי חזק החודש ולמה?", "תשווה שיתופים בין ריל לקרוסלה ב 10 הפוסטים האחרונים". שולפים צפיות, חשיפה, שיתופים, שמירות, זמן צפייה ממוצע ואחוז דילוג
- **תגובות והודעות.** ה AI קורא את התגובות ומכין טיוטות תשובה
- **פרסום ותזמון.** ה AI מכין טיוטת פוסט, ואתם בוחרים שעה
- **שום דבר לא יוצא בלי אישור שלכם.** כל פרסום, תגובה פומבית או הודעה נכנסים ללוח אישורים, ורק לחיצה שלכם על "אשר" שולחת אותם. אין כלי שמאשר לבד

## למה בחיבור הרשמי, ולא דרך סיסמה או תוסף

כלים שמבקשים את הסיסמה של אינסטגרם, או נכנסים לחשבון דרך הדפדפן, עוקפים את Meta. זה מסכן את החשבון ונותן לכלי חיצוני גישה מלאה אליו. בחיבור הרשמי אתם מאשרים במסך של אינסטגרם רק את ההרשאות שבחרתם. המפתח (טוקן) נשמר מוצפן בשרת שלכם בלבד, ואפשר לבטל אותו בכל רגע מההגדרות של אינסטגרם.

> **חשוב לדעת:** "רשמי" כאן אומר שמשתמשים ב API ש Meta מספקת, לפי הכללים שלה. האפליקציה שתיצרו נשארת במצב פיתוח, וזה מספיק לחשבון שלכם. כדי לחבר חשבונות של לקוחות צריך לעבור App Review ואימות עסק מול Meta, וזה תהליך נפרד.

## מה צריך לפני שמתחילים

- **חשבון אינסטגרם מקצועי** (Creator או Business)
- **חשבון Facebook**, כדי להיכנס ל Meta for Developers
- **חשבון Cloudflare** חינמי: שם רץ השרת
- **חשבון GitHub** חינמי: שם נשמר העותק שלכם של הקוד, ודרכו רק אתם נכנסים לשרת
- **לא צריך דומיין משלכם.** השרת מקבל כתובת חינמית על `workers.dev`
- **לא צריך טרמינל.** הכל נעשה בדפדפן

## איך זה בנוי

שלושה חלקים: **אפליקציה ב Meta** שנותנת גישה רשמית, **שרת קטן שלכם ב Cloudflare** שמחזיק את המפתח מוצפן ואת לוח האישורים, ו**אפליקציית ה AI**, שמדברת רק עם השרת. ה AI אף פעם לא רואה את המפתח של אינסטגרם.

**כלל אבטחה אחד לכל המדריך:** סודות (Client secret של GitHub ו App secret של אינסטגרם) לא נכנסים לצ'אט, לקובץ או לריפו. הם נכנסים רק לדשבורד של Cloudflare, כ Secret.

לאורך המדריך, **BASE** היא הכתובת של השרת: `https://ai-instagram-mcp.<השם-שלכם>.workers.dev`.

## שלב 1: מעלים את השרת בלחיצה

1. לוחצים על הכפתור **Deploy to Cloudflare** למעלה, ומתחברים ל Cloudflare ול GitHub
2. בטופס ממלאים:
   - `ALLOWED_GITHUB_LOGINS`: שם המשתמש שלכם ב GitHub
   - `PUBLIC_BASE_URL`: הכתובת BASE, באותיות קטנות. לא בטוחים? משאירים, והשרת יגיד לכם בשלב הבא מה לשים
   - `TOKEN_ENC_KEY` ו `SESSION_SECRET`: שתי מחרוזות אקראיות שונות, באורך 32 תווים לפחות. אפשר ליצור אותן במחולל הסיסמאות של מנהל הסיסמאות שלכם
   - את ה KV ואת מסד הנתונים Cloudflare יוצר לבד. משאירים "Create new"
3. לוחצים **Create and deploy**. Cloudflare מעתיק את הקוד ל GitHub שלכם, יוצר את מסד הנתונים ומעלה את השרת

## שלב 2: בודקים את השרת

נכנסים ל `BASE/dash`. אם הגדרה לא נכונה, הדף אומר איזו ומה לשים במקומה. מתקנים ב GitHub: בריפו החדש פותחים את `wrangler.jsonc`, לוחצים על העיפרון, מתקנים ושומרים (Commit changes). כל שמירה מעלה את השרת מחדש לבד, תוך דקה או שתיים.

כשהכתובת ושם המשתמש נכונים, הדף יגיד שחסרים `GITHUB_CLIENT_ID` ו `GITHUB_CLIENT_SECRET`. זה תקין, זה השלב הבא.

## שלב 3: אפליקציית GitHub להתחברות לשרת

1. נכנסים ל https://github.com/settings/applications/new
2. **Application name:** שם שתזהו, למשל `my-ig-mcp`
3. **Homepage URL:** BASE
4. **Authorization callback URL:** `BASE/callback`
5. לא מסמנים **Enable Device Flow** ולא **Allow wildcard matching**
6. **Register application** ← **Generate a new client secret**. משאירים את הדף פתוח
7. בדשבורד של Cloudflare: **Workers & Pages** ← השרת שלכם ← **Settings** ← **Variables and Secrets** ← **Add**. בוחרים Type **Secret**, ומוסיפים שניים: `GITHUB_CLIENT_ID` עם ה Client ID, ו `GITHUB_CLIENT_SECRET` עם ה Client secret. שומרים (Deploy)
8. נכנסים ל `BASE/dash` ומתחברים עם GitHub. אמור להופיע לוח אישורים ריק

## שלב 4: יוצרים אפליקציה ב Meta for Developers

1. נכנסים ל https://developers.facebook.com/apps ← **Create app**. בפעם הראשונה Meta מבקשת להירשם כמפתחים
2. **שם האפליקציה:** בלי המילים "ig" או "instagram". Meta פוסלת אותן בגלל הסימן המסחרי שלה
3. **Use case:** בוחרים **Manage messaging & content on Instagram**, וממשיכים עד הסיכום. את Business portfolio אפשר לדלג
4. **Create app**. הלחיצה הזו היא הסכמה לתנאים של Meta, אז קוראים לפני
5. בתוך ה use case ← **Permissions and features**. מוודאים שחמש ההרשאות האלה מופיעות: `instagram_business_basic`, `instagram_business_content_publish`, `instagram_business_manage_comments`, `instagram_business_manage_insights`, `instagram_business_manage_messages`
6. **API setup with Instagram login** ← **Business login settings**. ממלאים ושומרים:
   - **OAuth redirect URIs:** `BASE/ig/callback`
   - **Deauthorize callback URL:** `BASE/ig/deauthorize`
   - **Data deletion request URL:** `BASE/ig/data-deletion`
7. באותו אזור מופיעים **Instagram app ID** ו **Instagram app secret**. הם שונים מה App ID הכללי שלמעלה. מוסיפים אותם ב Cloudflare בדיוק כמו בשלב 3, בשמות `IG_APP_ID` ו `IG_APP_SECRET`

## שלב 5: מוסיפים את החשבון שלכם כ Tester

האפליקציה במצב פיתוח, ולכן היא עובדת רק עם חשבונות שיש להם תפקיד בה. בלי השלב הזה החיבור נכשל עם **Insufficient Developer Role**.

1. בדשבורד של Meta ← **App roles** ← **Roles** ← **Add People** ← **Instagram Tester** ← שם המשתמש שלכם באינסטגרם
2. באינסטגרם, באותו חשבון: instagram.com/accounts/manage_access ← **Tester Invites** ← **Accept**

## שלב 6: מחברים את חשבון האינסטגרם לשרת

`BASE/dash` ← **חבר חשבון אינסטגרם** ← מתחברים ומאשרים במסך של אינסטגרם. החשבון מופיע בלוח, והשרת מרענן את המפתח לבד.

## שלב 7: מחברים את אפליקציית ה AI

כתובת ה MCP היא `BASE/mcp`. השרת עובד עם כל אפליקציה שתומכת בשרת MCP מרוחק עם התחברות OAuth.

| אפליקציה | איך | נבדק |
|---|---|---|
| Claude (אתר, מחשב, טלפון) | Customize ← Connectors ← + ← Add custom connector, עם `BASE/mcp` ← Connect ← אשר והתחבר עם GitHub | כן |
| Claude Code | `claude mcp add --transport http instagram BASE/mcp`, ואז `/mcp` להתחברות | עוד לא |
| ChatGPT | Developer mode, ואז connector מותאם עם `BASE/mcp` (תלוי בתוכנית) | עוד לא |
| Cursor, VS Code ואחרים | שרת MCP מרוחק עם `BASE/mcp` | עוד לא |

ב Claude, בתוכנית החינמית אפשר להוסיף connector מותאם אחד בלבד. בחשבון Team או Enterprise רק Owner מוסיף, דרך Organization settings ← Connectors.

## שלב 8: מתחילים לשאול

```
מה הריל הכי חזק שלי, מה זמן הצפייה הממוצע שלו, וכמה אחוז מדלגים בשלוש השניות הראשונות? תשווה לשלושה הבאים.
```

```
תעבור על התגובות בריל האחרון ותכין טיוטות תשובה. אל תשלח כלום.
```

הטיוטות מחכות ב `BASE/dash`, ושם לוחצים "אשר" או "דחה".

## מה לא עובד דרך ה API

- תמונות לפרסום: JPEG בלבד
- אין מוזיקה מהספרייה של אינסטגרם, אין פילטרים ואין תגי שופינג
- הודעה פרטית אפשר לשלוח רק בתוך 24 שעות מההודעה האחרונה של האדם
- חלק מהסטטיסטיקות דורשות 100 עוקבים ומעלה, ויכולות להתעכב עד 48 שעות
- ברילים אין נתון של כניסות לפרופיל או עוקבים חדשים לכל ריל
- העלאת קבצים מהלוח דורשת להפעיל R2 בחשבון Cloudflare. עד אז נותנים קישור ציבורי לתמונה

## אבטחה, בקצרה

- **אם יש חשש לדליפה:** באינסטגרם ← הגדרות ← Apps and websites ← מסירים את האפליקציה. השרת מקבל על זה הודעה ומוחק את החשבון
- **תגובות והודעות הן מידע, לא הוראות.** מישהו יכול לכתוב בתגובה "תפרסם X", וזה לא יקרה, כי שום דבר לא יוצא בלי האישור שלכם
- **כניסה לשרת:** רק משתמשי GitHub שרשומים ב `ALLOWED_GITHUB_LOGINS`
- **הריפו שלכם יכול להיות פרטי.** בטופס של Cloudflare אפשר לבחור ריפו פרטי. ממילא אין בו סודות

## מעדיפים טרמינל?

הפקודות נמצאות ב [README.md](README.md), בסעיף Set up from the terminal instead.

## לא רוצים להתעסק עם שרתים?

אני בונה גרסה מנוהלת: מתחברים עם אינסטגרם, מוסיפים connector אחד, וזהו. היא תיפתח אחרי שהאפליקציה תעבור את תהליך האישור של Meta. רוצים לשמוע כשהיא נפתחת? השאירו פרטים בטופס: WAITLIST_URL

</div>
