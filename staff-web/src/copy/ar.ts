export const ar = {
  login: {
    title: 'تسجيل دخول الطاقم الطبي',
    mobileLabel: 'رقم الجوال',
    passwordLabel: 'كلمة المرور',
    submitButton: 'دخول',
    forgotPasswordLink: 'نسيت كلمة المرور؟',
  },
  forgotPassword: {
    title: 'استعادة كلمة المرور',
    mobileLabel: 'رقم الجوال',
    submitButton: 'إرسال رمز التحقق',
  },
  resetPassword: {
    title: 'إعادة تعيين كلمة المرور',
    codeLabel: 'رمز التحقق',
    newPasswordLabel: 'كلمة المرور الجديدة',
    submitButton: 'تعيين كلمة المرور',
  },
  changePassword: {
    title: 'يجب تغيير كلمة المرور',
    description: 'لأسباب أمنية، يجب عليك تعيين كلمة مرور جديدة قبل المتابعة',
    currentPasswordLabel: 'كلمة المرور الحالية',
    newPasswordLabel: 'كلمة المرور الجديدة',
    submitButton: 'تحديث كلمة المرور',
  },
  shell: {
    patientsLink: 'المرضى',
    logoutButton: 'تسجيل الخروج',
    roles: {
      CLINICIAN: 'أخصائي',
      SUPERVISOR: 'مشرف',
      ADMIN: 'مدير النظام',
    },
  },
  patients: {
    title: 'بحث عن المرضى',
    searchPlaceholder: 'ابحث بالاسم أو رقم الهوية',
    searchButton: 'بحث',
    tableName: 'الاسم',
    tableNationalId: 'رقم الهوية',
    tableGender: 'الجنس',
    tableDateOfBirth: 'تاريخ الميلاد',
    tableStatus: 'الحالة',
    genders: { MALE: 'ذكر', FEMALE: 'أنثى' } as Record<string, string>,
    statuses: { ACTIVE: 'نشط', DISABLED: 'معطل' } as Record<string, string>,
    noResults: 'لا توجد نتائج',
    emptyState: 'ابحث عن مريض بالاسم أو رقم الهوية',
  },
  errors: {
    unexpected: 'حدث خطأ غير متوقع',
  },
};
