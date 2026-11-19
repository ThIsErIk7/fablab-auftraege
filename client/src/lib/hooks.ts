import type { InvoiceSettings, MasterData } from '@fablab/shared';
import { useQuery } from '@tanstack/react-query';
import { api } from './api.ts';

export function useMasterData() {
  const q = useQuery({ queryKey: ['masterdata'], queryFn: () => api.get<MasterData>('/masterdata'), staleTime: 60_000 });
  const md = q.data;
  return {
    ...q,
    md,
    processName: (id: number | null | undefined) => md?.processes.find((p) => p.id === id)?.name ?? '',
    machineName: (id: number | null | undefined) => md?.machines.find((m) => m.id === id)?.name ?? '',
    material: (id: number | null | undefined) => md?.materials.find((m) => m.id === id),
  };
}

export function useInvoiceSettings() {
  return useQuery({ queryKey: ['settings', 'invoice'], queryFn: () => api.get<InvoiceSettings>('/settings/invoice') });
}
