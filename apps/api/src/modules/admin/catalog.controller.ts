import { apiContract } from "@boca/contracts";
import { Controller, Req } from "@nestjs/common";
import { TsRestHandler, tsRestHandler } from "@ts-rest/nest";
import type { RequestWithPrincipal } from "../../common/principal";
import { Roles } from "../../common/roles.decorator";
import { requirePrincipal } from "../../common/tenant-context";
import { CatalogService } from "./catalog.service";

@Controller()
@Roles("tenant_admin", "manager")
export class AdminCatalogController {
  constructor(private readonly catalog: CatalogService) {}

  // --- Allergens -----------------------------------------------------------
  @TsRestHandler(apiContract.admin.listAllergens)
  listAllergens(@Req() request: RequestWithPrincipal) {
    return tsRestHandler(apiContract.admin.listAllergens, async () => {
      const principal = requirePrincipal(request);
      return { status: 200 as const, body: await this.catalog.listAllergens(principal) };
    });
  }

  // --- Categories ----------------------------------------------------------
  @TsRestHandler(apiContract.admin.listCategories)
  listCategories(@Req() request: RequestWithPrincipal) {
    return tsRestHandler(apiContract.admin.listCategories, async () => {
      const principal = requirePrincipal(request);
      return { status: 200 as const, body: await this.catalog.listCategories(principal) };
    });
  }

  @TsRestHandler(apiContract.admin.createCategory)
  createCategory(@Req() request: RequestWithPrincipal) {
    return tsRestHandler(apiContract.admin.createCategory, async ({ body }) => {
      const principal = requirePrincipal(request);
      const result = await this.catalog.createCategory(principal, body);
      if (!result.ok) {
        return { status: result.status, body: { message: result.message } };
      }
      return { status: 201 as const, body: result.value };
    });
  }

  @TsRestHandler(apiContract.admin.updateCategory)
  updateCategory(@Req() request: RequestWithPrincipal) {
    return tsRestHandler(apiContract.admin.updateCategory, async ({ params, body }) => {
      const principal = requirePrincipal(request);
      const result = await this.catalog.updateCategory(principal, params.id, body);
      if (!result.ok) {
        return { status: result.status, body: { message: result.message } };
      }
      return { status: 200 as const, body: result.value };
    });
  }

  @TsRestHandler(apiContract.admin.archiveCategory)
  archiveCategory(@Req() request: RequestWithPrincipal) {
    return tsRestHandler(apiContract.admin.archiveCategory, async ({ params }) => {
      const principal = requirePrincipal(request);
      const result = await this.catalog.archiveCategory(principal, params.id);
      if (!result.ok) {
        return { status: result.status, body: { message: result.message } };
      }
      return { status: 200 as const, body: result.value };
    });
  }

  // --- Stations ------------------------------------------------------------
  @TsRestHandler(apiContract.admin.listStations)
  listStations(@Req() request: RequestWithPrincipal) {
    return tsRestHandler(apiContract.admin.listStations, async () => {
      const principal = requirePrincipal(request);
      return { status: 200 as const, body: await this.catalog.listStations(principal) };
    });
  }

  @TsRestHandler(apiContract.admin.createStation)
  createStation(@Req() request: RequestWithPrincipal) {
    return tsRestHandler(apiContract.admin.createStation, async ({ body }) => {
      const principal = requirePrincipal(request);
      const result = await this.catalog.createStation(principal, body);
      if (!result.ok) {
        return { status: result.status, body: { message: result.message } };
      }
      return { status: 201 as const, body: result.value };
    });
  }

  @TsRestHandler(apiContract.admin.updateStation)
  updateStation(@Req() request: RequestWithPrincipal) {
    return tsRestHandler(apiContract.admin.updateStation, async ({ params, body }) => {
      const principal = requirePrincipal(request);
      const result = await this.catalog.updateStation(principal, params.id, body);
      if (!result.ok) {
        return { status: result.status, body: { message: result.message } };
      }
      return { status: 200 as const, body: result.value };
    });
  }

  // --- Settings ------------------------------------------------------------
  @TsRestHandler(apiContract.admin.getSettings)
  getSettings(@Req() request: RequestWithPrincipal) {
    return tsRestHandler(apiContract.admin.getSettings, async () => {
      const principal = requirePrincipal(request);
      const result = await this.catalog.getSettings(principal);
      if (!result.ok) {
        return { status: result.status, body: { message: result.message } };
      }
      return { status: 200 as const, body: result.value };
    });
  }

  @TsRestHandler(apiContract.admin.updateTenant)
  updateTenant(@Req() request: RequestWithPrincipal) {
    return tsRestHandler(apiContract.admin.updateTenant, async ({ body }) => {
      const principal = requirePrincipal(request);
      const result = await this.catalog.updateTenant(principal, body);
      if (!result.ok) {
        return { status: result.status, body: { message: result.message } };
      }
      return { status: 200 as const, body: result.value };
    });
  }

  @TsRestHandler(apiContract.admin.updateLocation)
  updateLocation(@Req() request: RequestWithPrincipal) {
    return tsRestHandler(apiContract.admin.updateLocation, async ({ params, body }) => {
      const principal = requirePrincipal(request);
      const result = await this.catalog.updateLocation(principal, params.id, body);
      if (!result.ok) {
        return { status: result.status, body: { message: result.message } };
      }
      return { status: 200 as const, body: result.value };
    });
  }

  // --- Users ---------------------------------------------------------------
  @TsRestHandler(apiContract.admin.listUsers)
  listUsers(@Req() request: RequestWithPrincipal) {
    return tsRestHandler(apiContract.admin.listUsers, async () => {
      const principal = requirePrincipal(request);
      return { status: 200 as const, body: await this.catalog.listUsers(principal) };
    });
  }

  // Stricter than the controller default: user creation is tenant_admin only.
  @TsRestHandler(apiContract.admin.createUser)
  @Roles("tenant_admin")
  createUser(@Req() request: RequestWithPrincipal) {
    return tsRestHandler(apiContract.admin.createUser, async ({ body }) => {
      const principal = requirePrincipal(request);
      const result = await this.catalog.createUser(principal, body);
      if (!result.ok) {
        return { status: result.status, body: { message: result.message } };
      }
      return { status: 201 as const, body: result.value };
    });
  }

  @TsRestHandler(apiContract.admin.deactivateUser)
  @Roles("tenant_admin")
  deactivateUser(@Req() request: RequestWithPrincipal) {
    return tsRestHandler(apiContract.admin.deactivateUser, async ({ params }) => {
      const principal = requirePrincipal(request);
      const result = await this.catalog.deactivateUser(principal, params.id);
      if (!result.ok) {
        return { status: result.status, body: { message: result.message } };
      }
      return { status: 200 as const, body: result.value };
    });
  }
}
