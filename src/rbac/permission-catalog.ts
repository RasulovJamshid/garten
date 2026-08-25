import { PermissionScope } from '../common/auth-context';

export interface PermissionDef {
  group: string;
  key: string;
  scopes: readonly PermissionScope[];
  descriptionUz: string;
  descriptionRu: string;
  sensitive?: boolean;
}

/**
 * The single source of truth for what permissions exist and what scopes
 * they support (kindergarten-docs 01-stage1-plan.md §5.1).
 *
 * Code owns this list. Data (the `role`/`role_permission` tables) owns
 * who is granted what. Permissions synced here on boot are never created
 * via API — a grant with no enforcing endpoint is a silent security hole.
 */
export const PERMISSION_CATALOG: readonly PermissionDef[] = [
  // --- children --------------------------------------------------------
  {
    group: 'children',
    key: 'child:read',
    scopes: ['all', 'branch', 'own_group'],
    descriptionUz: "Bola profilini ko'rish",
    descriptionRu: 'Просмотр профиля ребёнка',
  },
  {
    group: 'children',
    key: 'child:create',
    scopes: ['all', 'branch'],
    descriptionUz: 'Bola qo’shish',
    descriptionRu: 'Добавление ребёнка',
  },
  {
    group: 'children',
    key: 'child:update',
    scopes: ['all', 'branch'],
    descriptionUz: 'Bola ma’lumotini tahrirlash',
    descriptionRu: 'Редактирование данных ребёнка',
  },
  {
    group: 'children',
    key: 'child:delete',
    scopes: ['all'],
    descriptionUz: "Bolani o'chirish",
    descriptionRu: 'Удаление ребёнка',
    sensitive: true,
  },
  {
    group: 'children',
    key: 'child:status',
    scopes: ['all', 'branch'],
    descriptionUz: 'Bola statusini o’zgartirish',
    descriptionRu: 'Изменение статуса ребёнка',
  },

  // --- medical -----------------------------------------------------------
  {
    group: 'medical',
    key: 'medical:read',
    scopes: ['all', 'branch', 'own_group'],
    descriptionUz: "To'liq tibbiy ma'lumot",
    descriptionRu: 'Полная медицинская карта',
  },
  {
    group: 'medical',
    key: 'medical:alerts',
    scopes: ['all', 'branch', 'own_group'],
    descriptionUz: 'Tibbiy ogohlantirishlar',
    descriptionRu: 'Медицинские предупреждения',
  },
  {
    group: 'medical',
    key: 'medical:write',
    scopes: ['all', 'branch'],
    descriptionUz: "Tibbiy ma'lumotni tahrirlash",
    descriptionRu: 'Редактирование медицинских данных',
  },

  // --- consent ---------------------------------------------------------
  {
    group: 'consent',
    key: 'consent:read',
    scopes: ['all', 'branch'],
    descriptionUz: 'Rozilik yozuvlarini ko’rish',
    descriptionRu: 'Просмотр записей согласия',
  },
  {
    group: 'consent',
    key: 'consent:manage',
    scopes: ['all', 'branch'],
    descriptionUz: 'Rozilikni qayd etish',
    descriptionRu: 'Фиксация согласия',
  },

  // --- attendance ----------------------------------------------------
  {
    group: 'attendance',
    key: 'attendance:read',
    scopes: ['all', 'branch', 'own_group', 'today'],
    descriptionUz: 'Davomatni ko’rish',
    descriptionRu: 'Просмотр посещаемости',
  },
  {
    group: 'attendance',
    key: 'attendance:checkin',
    scopes: ['all', 'branch', 'own_group'],
    descriptionUz: 'Kelishini belgilash',
    descriptionRu: 'Отметка прихода',
  },
  {
    group: 'attendance',
    key: 'attendance:checkout',
    scopes: ['all', 'branch', 'own_group'],
    descriptionUz: 'Ketishini belgilash',
    descriptionRu: 'Отметка ухода',
  },
  {
    group: 'attendance',
    key: 'attendance:correct',
    scopes: ['all', 'branch'],
    descriptionUz: 'Davomatni tuzatish',
    descriptionRu: 'Коррекция посещаемости',
  },

  // --- pickup ------------------------------------------------------------
  {
    group: 'pickup',
    key: 'pickup:read',
    scopes: ['all', 'branch', 'own_group'],
    descriptionUz: 'Olib ketuvchilar ro’yxati',
    descriptionRu: 'Список лиц, забирающих ребёнка',
  },
  {
    group: 'pickup',
    key: 'pickup:manage',
    scopes: ['all', 'branch'],
    descriptionUz: 'Doimiy ruxsatlarni boshqarish',
    descriptionRu: 'Управление постоянными разрешениями',
  },
  {
    group: 'pickup',
    key: 'pickup:temporary',
    scopes: ['all', 'branch'],
    descriptionUz: 'Vaqtinchalik ruxsat berish',
    descriptionRu: 'Выдача временного разрешения',
  },

  // --- groups --------------------------------------------------------
  {
    group: 'groups',
    key: 'group:read',
    scopes: ['all', 'branch'],
    descriptionUz: 'Guruhlarni ko’rish',
    descriptionRu: 'Просмотр групп',
  },
  {
    group: 'groups',
    key: 'group:manage',
    scopes: ['all', 'branch'],
    descriptionUz: 'Guruhlarni boshqarish',
    descriptionRu: 'Управление группами',
  },
  {
    group: 'groups',
    key: 'group:capacity_override',
    scopes: ['all'],
    descriptionUz: 'Sig’imdan oshirib qabul qilish',
    descriptionRu: 'Превышение вместимости группы',
    sensitive: true,
  },

  // --- guardians -----------------------------------------------------
  {
    group: 'guardians',
    key: 'guardian:read',
    scopes: ['all', 'branch'],
    descriptionUz: "Ota-onalar ma'lumoti",
    descriptionRu: 'Данные родителей',
  },
  {
    group: 'guardians',
    key: 'guardian:manage',
    scopes: ['all', 'branch'],
    descriptionUz: 'Ota-onalarni boshqarish',
    descriptionRu: 'Управление данными родителей',
  },

  // --- finance -------------------------------------------------------
  {
    group: 'finance',
    key: 'tariff:manage',
    scopes: ['all'],
    descriptionUz: 'Tariflarni boshqarish',
    descriptionRu: 'Управление тарифами',
    sensitive: true,
  },
  {
    group: 'finance',
    key: 'charge:read',
    scopes: ['all', 'branch'],
    descriptionUz: 'Hisoblarni ko’rish',
    descriptionRu: 'Просмотр начислений',
  },
  {
    group: 'finance',
    key: 'charge:generate',
    scopes: ['all'],
    descriptionUz: 'Hisob-fakturalar yaratish',
    descriptionRu: 'Формирование начислений',
  },
  {
    group: 'finance',
    key: 'charge:reverse',
    scopes: ['all'],
    descriptionUz: 'Hisobni bekor qilish',
    descriptionRu: 'Сторнирование начисления',
    sensitive: true,
  },
  {
    group: 'finance',
    key: 'payment:read',
    scopes: ['all', 'branch'],
    descriptionUz: 'To’lovlarni ko’rish',
    descriptionRu: 'Просмотр платежей',
  },
  {
    group: 'finance',
    key: 'payment:create',
    scopes: ['all', 'branch'],
    descriptionUz: 'To’lov qabul qilish',
    descriptionRu: 'Регистрация платежа',
  },
  {
    group: 'finance',
    key: 'payment:cancel',
    scopes: ['all'],
    descriptionUz: 'To’lovni bekor qilish',
    descriptionRu: 'Отмена платежа',
    sensitive: true,
  },
  {
    group: 'finance',
    key: 'discount:manage',
    scopes: ['all'],
    descriptionUz: 'Chegirmalarni boshqarish',
    descriptionRu: 'Управление скидками',
    sensitive: true,
  },
  {
    group: 'finance',
    key: 'period:close',
    scopes: ['all'],
    descriptionUz: 'Davrni yopish',
    descriptionRu: 'Закрытие периода',
    sensitive: true,
  },
  {
    group: 'finance',
    key: 'period:reopen',
    scopes: ['all'],
    descriptionUz: 'Davrni qayta ochish',
    descriptionRu: 'Открытие периода заново',
    sensitive: true,
  },
  {
    group: 'finance',
    key: 'debt:read',
    scopes: ['all', 'branch', 'own_group'],
    descriptionUz: 'Qarzdorlikni ko’rish',
    descriptionRu: 'Просмотр задолженности',
  },
  {
    group: 'finance',
    key: 'billing_rules:manage',
    scopes: ['all'],
    descriptionUz: 'Hisoblash qoidalarini boshqarish',
    descriptionRu: 'Управление правилами начисления',
    sensitive: true,
  },

  // --- notifications -------------------------------------------------
  {
    group: 'notifications',
    key: 'announcement:manage',
    scopes: ['all', 'branch'],
    descriptionUz: 'E’lonlarni boshqarish',
    descriptionRu: 'Управление объявлениями',
  },
  {
    group: 'notifications',
    key: 'notification:send',
    scopes: ['all', 'branch'],
    descriptionUz: 'Xabar yuborish',
    descriptionRu: 'Отправка уведомлений',
  },
  {
    group: 'notifications',
    key: 'notification:read',
    scopes: ['all', 'branch'],
    descriptionUz: 'Xabar tarixini ko’rish',
    descriptionRu: 'Просмотр истории уведомлений',
  },
  {
    group: 'notifications',
    key: 'notification_template:manage',
    scopes: ['all'],
    descriptionUz: 'Shablonlarni boshqarish',
    descriptionRu: 'Управление шаблонами',
  },

  // --- reports ---------------------------------------------------------
  {
    group: 'reports',
    key: 'report:read',
    scopes: ['all', 'branch', 'own_group'],
    descriptionUz: 'Hisobotlarni ko’rish',
    descriptionRu: 'Просмотр отчётов',
  },

  // --- expenses ------------------------------------------------------
  {
    group: 'expenses',
    key: 'expense:read',
    scopes: ['all', 'branch'],
    descriptionUz: 'Xarajatlarni ko’rish',
    descriptionRu: 'Просмотр расходов',
  },
  {
    group: 'expenses',
    key: 'expense:manage',
    scopes: ['all', 'branch'],
    descriptionUz: 'Xarajatlarni boshqarish',
    descriptionRu: 'Управление расходами',
  },

  // --- imports / files -------------------------------------------------
  {
    group: 'imports',
    key: 'import:manage',
    scopes: ['all'],
    descriptionUz: 'Ma’lumot import qilish',
    descriptionRu: 'Импорт данных',
    sensitive: true,
  },
  {
    group: 'files',
    key: 'file:read',
    scopes: ['all', 'branch', 'own_group'],
    descriptionUz: 'Fayllarni yuklab olish',
    descriptionRu: 'Скачивание файлов',
  },
  {
    group: 'files',
    key: 'file:manage',
    scopes: ['all', 'branch'],
    descriptionUz: 'Fayllarni yuklash/o’chirish',
    descriptionRu: 'Загрузка/удаление файлов',
  },

  // --- dashboard -------------------------------------------------------
  {
    group: 'dashboard',
    key: 'dashboard:read',
    scopes: ['all', 'branch', 'own_group'],
    descriptionUz: 'Boshqaruv panelini ko’rish',
    descriptionRu: 'Просмотр дашборда',
  },

  // --- admin -------------------------------------------------------------
  {
    group: 'admin',
    key: 'role:manage',
    scopes: ['all'],
    descriptionUz: 'Rollarni boshqarish',
    descriptionRu: 'Управление ролями',
    sensitive: true,
  },
  {
    group: 'admin',
    key: 'role:manage:sensitive',
    scopes: ['all'],
    descriptionUz: 'Nozik ruxsatlarni berish',
    descriptionRu: 'Выдача чувствительных прав',
    sensitive: true,
  },
  {
    group: 'admin',
    key: 'user:manage',
    scopes: ['all'],
    descriptionUz: 'Foydalanuvchilarni boshqarish',
    descriptionRu: 'Управление пользователями',
    sensitive: true,
  },
  {
    group: 'admin',
    key: 'audit:read',
    scopes: ['all'],
    descriptionUz: 'Audit jurnalini ko’rish',
    descriptionRu: 'Просмотр журнала аудита',
  },
  {
    group: 'admin',
    key: 'settings:manage',
    scopes: ['all'],
    descriptionUz: 'Sozlamalarni boshqarish',
    descriptionRu: 'Управление настройками',
  },
  {
    group: 'admin',
    key: 'branch:manage',
    scopes: ['all'],
    descriptionUz: 'Filiallarni boshqarish',
    descriptionRu: 'Управление филиалами',
  },
  {
    group: 'admin',
    key: 'holiday:manage',
    scopes: ['all', 'branch'],
    descriptionUz: 'Dam olish kunlarini boshqarish',
    descriptionRu: 'Управление праздничными днями',
  },
] as const;

export type PermissionKey = (typeof PERMISSION_CATALOG)[number]['key'];

export const PERMISSION_KEYS: ReadonlySet<string> = new Set(PERMISSION_CATALOG.map((p) => p.key));

export function findPermission(key: string): PermissionDef | undefined {
  return PERMISSION_CATALOG.find((p) => p.key === key);
}
