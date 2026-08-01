/**
 * First-pass detection patterns for the redaction engine.
 * Extends the proven regex set of lib/telemetry/scrub.ts (P0-9) with the
 * §5.4 rule table. Pure data + regexes — no I/O.
 *
 * NOTE for verify.ts authors: do NOT import the RULE regexes from here into
 * the second pass (§5.7 F2 — correlated failure). The ONLY shared export is
 * BIP39_WORDS, which is canonical external DATA (bitcoin/bips english.txt,
 * sha256 2f5eed53a4727b4bf8880d8f3f199efc90e58503646d9ff8eff3a2ed3b24dbda),
 * not detection logic.
 */

// ---------------------------------------------------------------------------
// R1 / R1b / R1c — paths
// ---------------------------------------------------------------------------

/** R1 — local home absolute paths (scrub.ts FILE_PATH shape, extended). */
export const HOME_PATH =
  /(?:\/Users\/[^/\s"']+(?:\/[^\s"']*)?|\/home\/[^/\s"']+(?:\/[^\s"']*)?|[A-Za-z]:\\Users\\[^\\\s"']+(?:\\[^\s"']*)?)/g;

/** R1b — marblo worktree paths (ledger.worktreesRoot convention). */
export const WORKTREE_PATH =
  /(?:~|\/Users\/[^/\s"']+|\/home\/[^/\s"']+)?\/?\.marblo\/worktrees\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)?(?:\/[^\s"']*)?/g;

/**
 * R1c — residual absolute path token (a whole string value that starts at
 * the filesystem root). Applied AFTER R1/R1b masking; a survivor means an
 * absolute path shape we don't recognize → drop the item, don't mask.
 */
export const RESIDUAL_ABS_PATH = /^(?:\/[^\s]*|[A-Za-z]:\\[^\s]*)$/;

// ---------------------------------------------------------------------------
// R2 — PII (scrub.ts patterns, verbatim semantics)
// ---------------------------------------------------------------------------

export const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
export const PHONE_KR = /\b01[016789][-.\s]?\d{3,4}[-.\s]?\d{4}\b/g;
export const PHONE_INTL =
  /\+\d{1,3}[-.\s]?\d{2,4}[-.\s]?\d{3,4}[-.\s]?\d{3,4}\b/g;

// ---------------------------------------------------------------------------
// R3 — known API key prefixes → DROP item.
// Order matters: longer prefixes first (sk-ant- before sk-) so a partial
// match never splits a longer key (scrub.ts lesson).
// ---------------------------------------------------------------------------

export const KNOWN_KEY_PATTERNS: readonly RegExp[] = [
  /sk-ant-[A-Za-z0-9_-]{16,}/g, // Anthropic
  /sk-proj-[A-Za-z0-9_-]{16,}/g, // OpenAI project key
  /sk-or-v?1?-?[A-Za-z0-9_-]{16,}/g, // OpenRouter
  /sk_live_[A-Za-z0-9]{16,}/g, // Stripe secret (live)
  /sk_test_[A-Za-z0-9]{16,}/g, // Stripe secret (test)
  /rk_live_[A-Za-z0-9]{16,}/g, // Stripe restricted
  /pk_live_[A-Za-z0-9]{16,}/g, // Stripe publishable — still drop
  /sk-[A-Za-z0-9_-]{16,}/g, // OpenAI legacy / generic sk-
  /AIza[A-Za-z0-9_-]{16,}/g, // Google API key
  /ya29\.[A-Za-z0-9_-]{16,}/g, // Google OAuth access token
  /1\/\/0[A-Za-z0-9_-]{16,}/g, // Google OAuth refresh token
  /xai-[A-Za-z0-9_-]{16,}/g, // xAI
  /github_pat_[A-Za-z0-9_]{16,}/g, // GitHub fine-grained PAT
  /gh[pousr]_[A-Za-z0-9]{16,}/g, // GitHub ghp_/gho_/ghu_/ghs_/ghr_
  /glpat-[A-Za-z0-9_-]{16,}/g, // GitLab PAT
  /glc_[A-Za-z0-9+/=_-]{16,}/g, // Grafana cloud
  /xox[baprs]-[A-Za-z0-9-]{10,}/g, // Slack tokens
  /hooks\.slack\.com\/services\/[A-Za-z0-9/_-]+/g, // Slack webhook
  /(?:AKIA|ASIA)[A-Z0-9]{16}/g, // AWS access key id
  /hf_[A-Za-z0-9]{16,}/g, // HuggingFace
  /nvapi-[A-Za-z0-9_-]{16,}/g, // NVIDIA
  /pplx-[A-Za-z0-9]{16,}/g, // Perplexity
  /r8_[A-Za-z0-9]{16,}/g, // Replicate
  /dop_v1_[a-f0-9]{16,}/g, // DigitalOcean PAT
  /SG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/g, // SendGrid
  /key-[a-f0-9]{32}/g, // Mailgun
  /gsk_[A-Za-z0-9]{16,}/g, // Groq
  /npm_[A-Za-z0-9]{16,}/g, // npm token
  /pypi-AgE[A-Za-z0-9_-]{16,}/g, // PyPI token
  /whsec_[A-Za-z0-9]{16,}/g, // Stripe webhook secret
  /shp(?:at|ca|pa|ss)_[a-fA-F0-9]{16,}/g, // Shopify
  /sq0(?:atp|csp)-[A-Za-z0-9_-]{16,}/g, // Square
  /figd_[A-Za-z0-9_-]{16,}/g, // Figma PAT
  /lin_api_[A-Za-z0-9]{16,}/g, // Linear
  /tvly-[A-Za-z0-9-]{16,}/g, // Tavily
  /sntrys_[A-Za-z0-9+/=_-]{16,}/g, // Sentry org token
  /ntn_[A-Za-z0-9]{16,}/g, // Notion (new)
  /secret_[A-Za-z0-9]{32,}/g, // Notion (legacy integration secret)
  /EAA[A-Za-z0-9]{20,}/g, // Meta/Facebook graph token
  /AGE-SECRET-KEY-1[A-Z0-9]{16,}/g, // age encryption
  /dckr_pat_[A-Za-z0-9_-]{16,}/g, // Docker Hub PAT
  /fly(?:v1|_api)[A-Za-z0-9_,.-]{16,}/g, // Fly.io
  /rnd_[A-Za-z0-9]{16,}/g, // Render
  /vercel_[A-Za-z0-9]{16,}/g, // Vercel
  /cda_[A-Za-z0-9]{16,}/g, // Contentful
  /doo_v1_[a-f0-9]{16,}/g, // DigitalOcean OAuth
  /pat-na\d-[a-f0-9-]{16,}/g, // HubSpot PAT
];

// ---------------------------------------------------------------------------
// R4 / R5 / R6 — structural secrets
// ---------------------------------------------------------------------------

/** R4 — JWT (three base64url segments; header always starts with eyJ). */
export const JWT = /eyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]+/g;

/** R5 — PEM private key blocks (BEGIN alone is enough to drop). */
export const PEM_PRIVATE_KEY = /-----BEGIN [A-Z ]*PRIVATE KEY-----/g;

/** R6 — connection strings carrying credentials (user:pass@). */
export const CREDENTIAL_URL =
  /\b(?:postgres|postgresql|mysql|mongodb(?:\+srv)?|redis|rediss|amqp|amqps|mssql|ftp|sftp)[^\s:]*:\/\/[^\s/:@]+:[^\s@]+@/gi;

/** Generic basic-auth in any URL (https://user:pass@host). */
export const URL_BASIC_AUTH = /\bhttps?:\/\/[^\s/:@]+:[^\s@]{3,}@/gi;

// ---------------------------------------------------------------------------
// R7 — secret-looking key NAMES (value masked regardless of content)
// ---------------------------------------------------------------------------

export const SECRET_KEY_NAME =
  /(_KEY|_TOKEN|_SECRET|_PASSWORD|_CREDENTIAL|_PAT|_DSN|^ANTHROPIC_|^OPENAI_|^GOOGLE_|^XAI_|^MOONSHOT_|^MARBLO_)/i;

/**
 * camelCase / free-form secret key names the underscore net misses.
 * F3 hardening — key names are attack surface too.
 */
export const SECRET_KEY_NAME_EXTENDED =
  /(api[_-]?key|secret|passw(or)?d|credential|passphrase|private[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|session[_-]?token|bearer|authorization|client[_-]?secret|signing[_-]?key)/i;

// ---------------------------------------------------------------------------
// R12 — infrastructure identifiers → DROP item
// ---------------------------------------------------------------------------

export const INFRA_PATTERNS: readonly RegExp[] = [
  /\bgs:\/\/[a-z0-9._-]+/gi, // GCS bucket
  /\bs3:\/\/[a-z0-9._-]+/gi, // S3 bucket
  /\bprojects\/[a-z][a-z0-9-]{4,28}[a-z0-9]\b/g, // GCP resource path
  /\b[a-z0-9-]+\.iam\.gserviceaccount\.com\b/gi, // GCP service account
  /\b[a-z0-9-]+@[a-z0-9-]+\.iam\.gserviceaccount\.com\b/gi,
  /\b[a-z0-9.-]+\.internal\b/gi, // internal hostnames
  /\b[a-z0-9.-]+\.svc\.cluster\.local\b/gi, // k8s service DNS
  /\b10\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, // private IPv4 10/8
  /\b192\.168\.\d{1,3}\.\d{1,3}\b/g, // private IPv4 192.168/16
  /\b172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}\b/g, // private IPv4 172.16/12
];

// ---------------------------------------------------------------------------
// R16 — ticket / document ids
// ---------------------------------------------------------------------------

/** Firestore-style 20-char alphanumeric document id (standalone token). */
export const FIRESTORE_ID = /^[A-Za-z0-9]{20}$/;
export const TICKET_REF = /#\d+\b/g;

// ---------------------------------------------------------------------------
// Field-name classifiers (used by rules.ts)
// ---------------------------------------------------------------------------

/** R9 — free-text prose fields (scrub.ts USER_INPUT_KEY superset). */
export const FREE_TEXT_KEY =
  /^(prompt|initialPrompt|instruction|instructions|message|messages|userInput|content|raw_input|rawInput|chat|terminal|terminalOutput|stdout|stderr|output|stack|stacktrace|stackTrace|error|errorMessage|detail|details|body|text|description|comment|comments|note|notes|narrative)$/i;

/** R10 — code / diff fields. */
export const CODE_DIFF_KEY =
  /^(diff|patch|code|codeExcerpt|changes|hunk|blob|source)$/i;

/** R2b — person identifier fields. */
export const PERSON_KEY =
  /^(actorUid|actorName|uid|userId|userName|user|author|authorName|email|owner|ownerUid|member|memberName|displayName|assignee|createdBy|updatedBy|requestedBy)$/i;

/** R2c — agent identifier fields. */
export const AGENT_KEY = /^(agentId|agentName|agent|spawnedBy|claimedBy)$/i;

/** R14 — cost / billing fields. */
export const COST_KEY =
  /^(cost|costTotal|totalCost|costUsd|price|amount|billing|tokens|tokenCount|totalTokens|inputTokens|outputTokens|promptTokens|completionTokens|usage|spend)$/i;

/** R15 — timestamp fields. */
export const TIMESTAMP_KEY =
  /(^(date|time|timestamp)$|(At|Time|Timestamp|Date|_at|_time)$)/;

/** R16 — ticket / doc id fields. */
export const TICKET_ID_KEY =
  /^(id|taskId|ticketId|docId|documentId|missionId|projectId|flowId|parentId|rootTaskId|questionId)$/i;

/** R11 — repository identifier fields. */
export const REPO_KEY =
  /^(repoUrl|repositoryUrl|repo|repository|repoRoot|repoName|branch|branchName|baseBranch|headBranch|remote|remoteUrl|prUrl|pullRequestUrl|sha|headSha|baseSha|commit|commitSha)$/i;

/** R13 — repo-relative path fields. */
export const REL_PATH_KEY =
  /^(scope|files|paths|filePaths|fileName|filename|file|path|filePath)$/i;

/** Known-safe structured scalar fields (still scanned — F3: 구조화라 안전은 없다). */
export const STRUCTURED_SAFE_KEY =
  /^(status|state|type|kind|eventType|success|ok|failed|count|total|durationMs|elapsedMs|version|appVersion|vendor|model|harness|role|level|priority|tool|toolName|action|category|template|templateId|goal|title|label|labels|name|step|steps|stepCount|progress|phase|result|outcome|summary|problem|approach|verification|reason|sensitivity|visibility|retryCount|attempt|index|order|size|lineCount|fileCount|added|removed|language|os|platform|tasks|subtasks|events|items|entries|activities|timeline|stats|cast)$/i;

// ---------------------------------------------------------------------------
// R17 — BIP39 wordlist (§5.7 F1). Canonical english.txt from bitcoin/bips,
// verified sha256 2f5eed53a4727b4bf8880d8f3f199efc90e58503646d9ff8eff3a2ed3b24dbda.
// 2048 words. DATA shared with verify.ts by design (canonical standard),
// detection LOGIC is implemented independently on each side.
// ---------------------------------------------------------------------------

const BIP39_RAW =
  "abandon ability able about above absent absorb abstract absurd abuse access accident account accuse achieve acid acoustic acquire across act action actor actress actual adapt add addict address adjust admit adult advance advice aerobic affair afford afraid again age agent agree ahead aim air airport aisle alarm album alcohol alert alien all alley allow almost alone alpha already also alter always amateur amazing among amount amused analyst anchor ancient anger angle angry animal ankle announce annual another answer antenna antique anxiety any apart apology appear apple approve april arch arctic area arena argue arm armed armor army around arrange arrest arrive arrow art artefact artist artwork ask aspect assault asset assist assume asthma athlete atom attack attend attitude attract auction audit august aunt author auto autumn average avocado avoid awake aware away awesome awful awkward axis baby bachelor bacon badge bag balance balcony ball bamboo banana banner bar barely bargain barrel base basic basket battle beach bean beauty because become beef before begin behave behind believe below belt bench benefit best betray better between beyond bicycle bid bike bind biology bird birth bitter black blade blame blanket blast bleak bless blind blood blossom blouse blue blur blush board boat body boil bomb bone bonus book boost border boring borrow boss bottom bounce box boy bracket brain brand brass brave bread breeze brick bridge brief bright bring brisk broccoli broken bronze broom brother brown brush bubble buddy budget buffalo build bulb bulk bullet bundle bunker burden burger burst bus business busy butter buyer buzz cabbage cabin cable cactus cage cake call calm camera camp can canal cancel candy cannon canoe canvas canyon capable capital captain car carbon card cargo carpet carry cart case cash casino castle casual cat catalog catch category cattle caught cause caution cave ceiling celery cement census century cereal certain chair chalk champion change chaos chapter charge chase chat cheap check cheese chef cherry chest chicken chief child chimney choice choose chronic chuckle chunk churn cigar cinnamon circle citizen city civil claim clap clarify claw clay clean clerk clever click client cliff climb clinic clip clock clog close cloth cloud clown club clump cluster clutch coach coast coconut code coffee coil coin collect color column combine come comfort comic common company concert conduct confirm congress connect consider control convince cook cool copper copy coral core corn correct cost cotton couch country couple course cousin cover coyote crack cradle craft cram crane crash crater crawl crazy cream credit creek crew cricket crime crisp critic crop cross crouch crowd crucial cruel cruise crumble crunch crush cry crystal cube culture cup cupboard curious current curtain curve cushion custom cute cycle dad damage damp dance danger daring dash daughter dawn day deal debate debris decade december decide decline decorate decrease deer defense define defy degree delay deliver demand demise denial dentist deny depart depend deposit depth deputy derive describe desert design desk despair destroy detail detect develop device devote diagram dial diamond diary dice diesel diet differ digital dignity dilemma dinner dinosaur direct dirt disagree discover disease dish dismiss disorder display distance divert divide divorce dizzy doctor document dog doll dolphin domain donate donkey donor door dose double dove draft dragon drama drastic draw dream dress drift drill drink drip drive drop drum dry duck dumb dune during dust dutch duty dwarf dynamic eager eagle early earn earth easily east easy echo ecology economy edge edit educate effort egg eight either elbow elder electric elegant element elephant elevator elite else embark embody embrace emerge emotion employ empower empty enable enact end endless endorse enemy energy enforce engage engine enhance enjoy enlist enough enrich enroll ensure enter entire entry envelope episode equal equip era erase erode erosion error erupt escape essay essence estate eternal ethics evidence evil evoke evolve exact example excess exchange excite exclude excuse execute exercise exhaust exhibit exile exist exit exotic expand expect expire explain expose express extend extra eye eyebrow fabric face faculty fade faint faith fall false fame family famous fan fancy fantasy farm fashion fat fatal father fatigue fault favorite feature february federal fee feed feel female fence festival fetch fever few fiber fiction field figure file film filter final find fine finger finish fire firm first fiscal fish fit fitness fix flag flame flash flat flavor flee flight flip float flock floor flower fluid flush fly foam focus fog foil fold follow food foot force forest forget fork fortune forum forward fossil foster found fox fragile frame frequent fresh friend fringe frog front frost frown frozen fruit fuel fun funny furnace fury future gadget gain galaxy gallery game gap garage garbage garden garlic garment gas gasp gate gather gauge gaze general genius genre gentle genuine gesture ghost giant gift giggle ginger giraffe girl give glad glance glare glass glide glimpse globe gloom glory glove glow glue goat goddess gold good goose gorilla gospel gossip govern gown grab grace grain grant grape grass gravity great green grid grief grit grocery group grow grunt guard guess guide guilt guitar gun gym habit hair half hammer hamster hand happy harbor hard harsh harvest hat have hawk hazard head health heart heavy hedgehog height hello helmet help hen hero hidden high hill hint hip hire history hobby hockey hold hole holiday hollow home honey hood hope horn horror horse hospital host hotel hour hover hub huge human humble humor hundred hungry hunt hurdle hurry hurt husband hybrid ice icon idea identify idle ignore ill illegal illness image imitate immense immune impact impose improve impulse inch include income increase index indicate indoor industry infant inflict inform inhale inherit initial inject injury inmate inner innocent input inquiry insane insect inside inspire install intact interest into invest invite involve iron island isolate issue item ivory jacket jaguar jar jazz jealous jeans jelly jewel job join joke journey joy judge juice jump jungle junior junk just kangaroo keen keep ketchup key kick kid kidney kind kingdom kiss kit kitchen kite kitten kiwi knee knife knock know lab label labor ladder lady lake lamp language laptop large later latin laugh laundry lava law lawn lawsuit layer lazy leader leaf learn leave lecture left leg legal legend leisure lemon lend length lens leopard lesson letter level liar liberty library license life lift light like limb limit link lion liquid list little live lizard load loan lobster local lock logic lonely long loop lottery loud lounge love loyal lucky luggage lumber lunar lunch luxury lyrics machine mad magic magnet maid mail main major make mammal man manage mandate mango mansion manual maple marble march margin marine market marriage mask mass master match material math matrix matter maximum maze meadow mean measure meat mechanic medal media melody melt member memory mention menu mercy merge merit merry mesh message metal method middle midnight milk million mimic mind minimum minor minute miracle mirror misery miss mistake mix mixed mixture mobile model modify mom moment monitor monkey monster month moon moral more morning mosquito mother motion motor mountain mouse move movie much muffin mule multiply muscle museum mushroom music must mutual myself mystery myth naive name napkin narrow nasty nation nature near neck need negative neglect neither nephew nerve nest net network neutral never news next nice night noble noise nominee noodle normal north nose notable note nothing notice novel now nuclear number nurse nut oak obey object oblige obscure observe obtain obvious occur ocean october odor off offer office often oil okay old olive olympic omit once one onion online only open opera opinion oppose option orange orbit orchard order ordinary organ orient original orphan ostrich other outdoor outer output outside oval oven over own owner oxygen oyster ozone pact paddle page pair palace palm panda panel panic panther paper parade parent park parrot party pass patch path patient patrol pattern pause pave payment peace peanut pear peasant pelican pen penalty pencil people pepper perfect permit person pet phone photo phrase physical piano picnic picture piece pig pigeon pill pilot pink pioneer pipe pistol pitch pizza place planet plastic plate play please pledge pluck plug plunge poem poet point polar pole police pond pony pool popular portion position possible post potato pottery poverty powder power practice praise predict prefer prepare present pretty prevent price pride primary print priority prison private prize problem process produce profit program project promote proof property prosper protect proud provide public pudding pull pulp pulse pumpkin punch pupil puppy purchase purity purpose purse push put puzzle pyramid quality quantum quarter question quick quit quiz quote rabbit raccoon race rack radar radio rail rain raise rally ramp ranch random range rapid rare rate rather raven raw razor ready real reason rebel rebuild recall receive recipe record recycle reduce reflect reform refuse region regret regular reject relax release relief rely remain remember remind remove render renew rent reopen repair repeat replace report require rescue resemble resist resource response result retire retreat return reunion reveal review reward rhythm rib ribbon rice rich ride ridge rifle right rigid ring riot ripple risk ritual rival river road roast robot robust rocket romance roof rookie room rose rotate rough round route royal rubber rude rug rule run runway rural sad saddle sadness safe sail salad salmon salon salt salute same sample sand satisfy satoshi sauce sausage save say scale scan scare scatter scene scheme school science scissors scorpion scout scrap screen script scrub sea search season seat second secret section security seed seek segment select sell seminar senior sense sentence series service session settle setup seven shadow shaft shallow share shed shell sheriff shield shift shine ship shiver shock shoe shoot shop short shoulder shove shrimp shrug shuffle shy sibling sick side siege sight sign silent silk silly silver similar simple since sing siren sister situate six size skate sketch ski skill skin skirt skull slab slam sleep slender slice slide slight slim slogan slot slow slush small smart smile smoke smooth snack snake snap sniff snow soap soccer social sock soda soft solar soldier solid solution solve someone song soon sorry sort soul sound soup source south space spare spatial spawn speak special speed spell spend sphere spice spider spike spin spirit split spoil sponsor spoon sport spot spray spread spring spy square squeeze squirrel stable stadium staff stage stairs stamp stand start state stay steak steel stem step stereo stick still sting stock stomach stone stool story stove strategy street strike strong struggle student stuff stumble style subject submit subway success such sudden suffer sugar suggest suit summer sun sunny sunset super supply supreme sure surface surge surprise surround survey suspect sustain swallow swamp swap swarm swear sweet swift swim swing switch sword symbol symptom syrup system table tackle tag tail talent talk tank tape target task taste tattoo taxi teach team tell ten tenant tennis tent term test text thank that theme then theory there they thing this thought three thrive throw thumb thunder ticket tide tiger tilt timber time tiny tip tired tissue title toast tobacco today toddler toe together toilet token tomato tomorrow tone tongue tonight tool tooth top topic topple torch tornado tortoise toss total tourist toward tower town toy track trade traffic tragic train transfer trap trash travel tray treat tree trend trial tribe trick trigger trim trip trophy trouble truck true truly trumpet trust truth try tube tuition tumble tuna tunnel turkey turn turtle twelve twenty twice twin twist two type typical ugly umbrella unable unaware uncle uncover under undo unfair unfold unhappy uniform unique unit universe unknown unlock until unusual unveil update upgrade uphold upon upper upset urban urge usage use used useful useless usual utility vacant vacuum vague valid valley valve van vanish vapor various vast vault vehicle velvet vendor venture venue verb verify version very vessel veteran viable vibrant vicious victory video view village vintage violin virtual virus visa visit visual vital vivid vocal voice void volcano volume vote voyage wage wagon wait walk wall walnut want warfare warm warrior wash wasp waste water wave way wealth weapon wear weasel weather web wedding weekend weird welcome west wet whale what wheat wheel when where whip whisper wide width wife wild will win window wine wing wink winner winter wire wisdom wise wish witness wolf woman wonder wood wool word work world worry worth wrap wreck wrestle wrist write wrong yard year yellow you young youth zebra zero zone zoo";

export const BIP39_WORDS: ReadonlySet<string> = new Set(BIP39_RAW.split(" "));

/** Minimum consecutive dictionary-word run treated as a mnemonic (12-word seed). */
export const MNEMONIC_MIN_RUN = 12;
