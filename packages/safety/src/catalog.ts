/**
 * The published list of report reasons and labels, with no server dependencies, so the browser can
 * show the same list the server enforces.
 */
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export type TargetType = 'post' | 'profile';
export type Severity = 'p0' | 'p1' | 'p2' | 'p3';

export type Category = {
  label: string;
  help: string;
  rule: string;
  clockMs: number;
  severity: Severity;
  /** Hide before review. Standing and the hourly budget can switch this off. */
  autoHide: boolean;
  /** Whole accounts are hidden automatically only for these categories. */
  autoHideProfiles: boolean;
  requiresDeclaration: boolean;
  requiresEmail: boolean;
  /** Never publish the target of these, because the pointer itself would do harm. */
  privateTarget: boolean;
};

const queueCategory = (label: string, help: string, rule: string, clockMs: number, severity: Severity): Category => ({
  label,
  help,
  rule,
  clockMs,
  severity,
  autoHide: false,
  autoHideProfiles: false,
  requiresDeclaration: false,
  requiresEmail: false,
  privateTarget: false,
});

export const CATEGORIES: Record<string, Category> = {
  child_safety: {
    label: 'Sexual content involving a child',
    help: 'Hidden as soon as you file this, and reported to the authorities.',
    rule: 'POCSO Act 2012 s.15, s.19; POCSO Rules 2020 r.11',
    clockMs: 0,
    severity: 'p0',
    autoHide: true,
    autoHideProfiles: false,
    requiresDeclaration: false,
    requiresEmail: false,
    privateTarget: true,
  },
  intimate_or_impersonation: {
    label: 'Nudity, sexual content, morphed images or impersonation of me',
    help: 'File this if it shows or impersonates you, or someone you represent. It is hidden while we review it.',
    rule: 'IT Rules 2021 r.3(2)(b)',
    clockMs: 2 * HOUR,
    severity: 'p1',
    autoHide: true,
    autoHideProfiles: true,
    requiresDeclaration: true,
    requiresEmail: true,
    privateTarget: true,
  },
  threat: { ...queueCategory('A threat of violence', 'A credible threat against a person or group.', 'IT Rules 2021 r.3(1)(b)(vii)', 36 * HOUR, 'p2'), privateTarget: true },
  harassment: queueCategory('Targeted harassment', 'Harassment aimed at a person, including on the basis of gender.', 'IT Rules 2021 r.3(1)(b)(ii)', 36 * HOUR, 'p2'),
  privacy: { ...queueCategory('My private information', 'Home address, phone number, ID numbers or other private details.', 'IT Rules 2021 r.3(1)(b)(ii)', 36 * HOUR, 'p2'), privateTarget: true },
  hate: queueCategory('Incitement against a group', 'Promoting enmity on grounds of religion or caste with intent to incite violence, or racially or ethnically objectionable content.', 'IT Rules 2021 r.3(1)(b)(ii)', 36 * HOUR, 'p2'),
  misinformation: queueCategory('Deliberately false information', 'Knowingly false or misleading, or lying about where a message comes from.', 'IT Rules 2021 r.3(1)(b)(v)', 36 * HOUR, 'p2'),
  malware: queueCategory('Malware or a scam link', 'Code or links designed to damage a computer or steal from someone.', 'IT Rules 2021 r.3(1)(b)(viii)', 36 * HOUR, 'p2'),
  copyright: queueCategory('Copyright or trademark', 'Infringes a patent, trademark, copyright or other proprietary right.', 'IT Rules 2021 r.3(1)(b)(iv)', 7 * DAY, 'p3'),
  illegal: queueCategory('Something else illegal', 'Violates a law not listed above.', 'IT Rules 2021 r.3(1)(b)(xi)', 7 * DAY, 'p3'),
  other: queueCategory('Anything else', 'Any other complaint about this post or account.', 'IT Rules 2021 r.3(2)(a)(i)', 7 * DAY, 'p3'),
};

export const LABELS: Record<string, { label: string; help: string; defaultAction: 'hide' | 'warn' | 'show' }> = {
  adult: { label: 'Adult', help: 'Sexual or adult content.', defaultAction: 'warn' },
  graphic: { label: 'Graphic', help: 'Graphic descriptions of violence or injury.', defaultAction: 'warn' },
  self_harm: { label: 'Self-harm', help: 'Discussion of suicide or self-harm.', defaultAction: 'warn' },
  hateful: { label: 'Hateful', help: 'Insulting language aimed at a group.', defaultAction: 'warn' },
  rude: { label: 'Rude', help: 'Insults and abuse that stay within the law.', defaultAction: 'show' },
  spam: { label: 'Spam', help: 'Repeated, automated or promotional posting.', defaultAction: 'hide' },
};

