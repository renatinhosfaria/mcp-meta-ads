import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  makeRequest,
  paginate,
  handleApiError,
  getAccessToken,
  normalizeAdAccountId,
  toJson,
} from '../client.js';
import { AD_ACCOUNT_FIELDS } from '../constants.js';
import type { AdAccount, MetaApiResponse } from '../types.js';

export function registerAccountTools(server: McpServer): void {
  server.registerTool(
    'meta_list_ad_accounts',
    {
      title: 'Listar Contas de Anúncio',
      description:
        'Lista todas as contas de anúncio (Ad Accounts) acessíveis pelo token. ' +
        'Retorna ID, nome, status, moeda, saldo e gasto total. ' +
        'Use esta ferramenta para descobrir os IDs das contas disponíveis antes de operar sobre campanhas. ' +
        'Se META_BUSINESS_ID estiver configurado, lista contas do Business Manager; ' +
        'caso contrário, lista contas do usuário autenticado.',
      inputSchema: z.object({
        business_id: z
          .string()
          .optional()
          .describe(
            'ID do Business Manager (opcional). Se omitido, usa META_BUSINESS_ID do .env ' +
            'ou lista contas do usuário via /me/adaccounts.'
          ),
        limit: z
          .number()
          .int()
          .min(1)
          .max(500)
          .default(50)
          .describe('Número máximo de contas a retornar (padrão: 50).'),
      }).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ business_id, limit }) => {
      try {
        const bid = business_id || process.env.META_BUSINESS_ID;
        const endpoint = bid
          ? `${bid}/owned_ad_accounts`
          : 'me/adaccounts';

        const accounts = await paginate<AdAccount>(
          endpoint,
          { fields: AD_ACCOUNT_FIELDS },
          limit
        );

        const result = {
          total: accounts.length,
          accounts: accounts.map((a) => ({
            id: a.id,
            name: a.name,
            account_id: a.account_id,
            status: accountStatusLabel(a.account_status),
            currency: a.currency,
            timezone: a.timezone_name,
            amount_spent: formatCurrency(a.amount_spent, a.currency),
            balance: formatCurrency(a.balance, a.currency),
            spend_cap: a.spend_cap ? formatCurrency(a.spend_cap, a.currency) : null,
            business: a.business?.name || null,
          })),
        };

        return {
          content: [{ type: 'text' as const, text: toJson(result) }],
          structuredContent: result,
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: handleApiError(error) }],
        };
      }
    }
  );

  server.registerTool(
    'meta_get_ad_account',
    {
      title: 'Detalhes da Conta de Anúncio',
      description:
        'Retorna detalhes completos de uma conta de anúncio específica: ' +
        'saldo, gasto total, limite de gasto, moeda, fuso horário e status. ' +
        'Use para verificar o estado financeiro de uma conta antes de criar campanhas.',
      inputSchema: z.object({
        ad_account_id: z
          .string()
          .describe(
            'ID da conta de anúncio (com ou sem prefixo act_, ex: act_123456789 ou 123456789). ' +
            'Se omitido, usa META_AD_ACCOUNT_ID do .env.'
          )
          .optional(),
      }).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ ad_account_id }) => {
      try {
        const accountId = ad_account_id
          ? normalizeAdAccountId(ad_account_id)
          : (() => {
              const id = process.env.META_AD_ACCOUNT_ID;
              if (!id) throw new Error('Informe ad_account_id ou configure META_AD_ACCOUNT_ID no .env');
              return normalizeAdAccountId(id);
            })();

        const account = await makeRequest<AdAccount>(accountId, 'GET', {
          fields: AD_ACCOUNT_FIELDS,
        });

        const result = {
          id: account.id,
          name: account.name,
          account_id: account.account_id,
          status: accountStatusLabel(account.account_status),
          status_code: account.account_status,
          currency: account.currency,
          timezone: account.timezone_name,
          amount_spent: formatCurrency(account.amount_spent, account.currency),
          balance: formatCurrency(account.balance, account.currency),
          spend_cap: account.spend_cap
            ? formatCurrency(account.spend_cap, account.currency)
            : 'Sem limite',
          business: account.business
            ? { id: account.business.id, name: account.business.name }
            : null,
        };

        return {
          content: [{ type: 'text' as const, text: toJson(result) }],
          structuredContent: result,
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: handleApiError(error) }],
        };
      }
    }
  );
}

function accountStatusLabel(status: number): string {
  const labels: Record<number, string> = {
    1: 'ACTIVE',
    2: 'DISABLED',
    3: 'UNSETTLED',
    7: 'PENDING_RISK_REVIEW',
    8: 'PENDING_SETTLEMENT',
    9: 'IN_GRACE_PERIOD',
    100: 'PENDING_CLOSURE',
    101: 'CLOSED',
    201: 'ANY_ACTIVE',
    202: 'ANY_CLOSED',
  };
  return labels[status] || `UNKNOWN(${status})`;
}

function formatCurrency(value: string | undefined, currency: string): string {
  if (!value) return '0.00';
  const num = parseFloat(value) / 100;
  return `${num.toFixed(2)} ${currency}`;
}
