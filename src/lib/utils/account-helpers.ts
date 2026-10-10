export function validateAccountCode(code: string): { valid: boolean; error?: string } {
  if (!code || code.length === 0) {
    return { valid: false, error: "Le code du compte est requis." };
  }
  if (code.length > 11) {
    return { valid: false, error: "Le code du compte ne doit pas dépasser 11 caractères." };
  }
  if (!/^\d+$/.test(code)) {
    return { valid: false, error: "Le code du compte ne doit contenir que des chiffres." };
  }
  const firstDigit = parseInt(code[0]!);
  if (firstDigit < 1 || firstDigit > 9) {
    return { valid: false, error: "Le code du compte doit commencer par un chiffre entre 1 et 9." };
  }
  return { valid: true };
}

export function getClassFromCode(code: string): number {
  return parseInt(code[0]!);
}

export function isChildOfParent(childCode: string, parentCode: string): boolean {
  return childCode.startsWith(parentCode) && childCode.length > parentCode.length;
}

export function getClassLabel(classNumber: number): string {
  const labels: Record<number, string> = {
    1: "Comptes de financement permanent",
    2: "Comptes d'actif immobilisé",
    3: "Comptes d'actif circulant",
    4: "Comptes de passif circulant",
    5: "Comptes de trésorerie",
    6: "Comptes de charges",
    7: "Comptes de produits",
    8: "Comptes de résultat",
  };
  return labels[classNumber] || "Autre";
}

export function getClassColor(classNumber: number): string {
  const colors: Record<number, string> = {
    1: "text-purple-600",
    2: "text-blue-600",
    3: "text-cyan-600",
    4: "text-orange-600",
    5: "text-green-600",
    6: "text-red-600",
    7: "text-emerald-600",
    8: "text-gray-600",
  };
  return colors[classNumber] || "text-gray-500";
}
