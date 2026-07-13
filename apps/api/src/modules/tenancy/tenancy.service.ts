import type { Location, Tenant, TenantContext } from "@boca/contracts";
import { findTenantById, listActiveLocations, withTenant } from "@boca/db";
import { Injectable } from "@nestjs/common";
import type { Principal } from "../../common/principal";

function toLocation(row: {
  id: string;
  name: string;
  timezone: string;
  address: string | null;
}): Location {
  return { id: row.id, name: row.name, timezone: row.timezone, address: row.address };
}

@Injectable()
export class TenancyService {
  /** GET /tenancy/me: tenant + active locations in ONE RLS-scoped tx. */
  async getTenantContext(principal: Principal): Promise<TenantContext | null> {
    return withTenant(principal.tenantId, async (trx) => {
      const tenant = await findTenantById(trx, principal.tenantId);
      if (!tenant) {
        return null;
      }
      const locations = await listActiveLocations(trx);
      return {
        tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name },
        locations: locations.map(toLocation),
      };
    });
  }

  async getCurrentTenant(principal: Principal): Promise<Tenant | null> {
    const tenant = await withTenant(principal.tenantId, (trx) =>
      findTenantById(trx, principal.tenantId),
    );
    return tenant ? { id: tenant.id, slug: tenant.slug, name: tenant.name } : null;
  }

  async listLocations(principal: Principal): Promise<Location[]> {
    const rows = await withTenant(principal.tenantId, (trx) => listActiveLocations(trx));
    return rows.map(toLocation);
  }
}
