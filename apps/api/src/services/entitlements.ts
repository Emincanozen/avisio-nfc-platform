/**
 * Résolution des droits d'un établissement.
 *
 * Point de passage unique entre le dépôt et la politique pure de
 * `@avisio/core`. Son existence tient à une règle simple : **aucune route ne
 * décide seule de ce à quoi un client a droit.** Chacune demande ici, et ce
 * qui revient est calculé à partir de l'abonnement facturé.
 *
 * Avant, chaque appelant faisait `hasFeature(establishment.plan, …)`. Vingt
 * endroits lisaient la même donnée modifiable par le client lui-même. Corriger
 * une route sur vingt n'aurait rien réglé.
 */

import { resolveEntitlements, type EntitlementState, type Establishment } from '@avisio/core';
import type { Repository } from '../repository/index.js';

export interface EntitlementService {
  /** Droits effectifs, lus depuis l'abonnement. */
  forEstablishment(
    establishment: Pick<Establishment, 'id' | 'plan' | 'addons'>,
  ): Promise<EntitlementState>;
  /** Variante quand seul l'identifiant est connu. `null` si introuvable. */
  forEstablishmentId(establishmentId: string): Promise<EntitlementState | null>;
}

export function createEntitlementService(repo: Repository): EntitlementService {
  const forEstablishment = async (
    establishment: Pick<Establishment, 'id' | 'plan' | 'addons'>,
  ): Promise<EntitlementState> => {
    const subscription = await repo.subscriptions.findByEstablishment(establishment.id);
    return resolveEntitlements(subscription, establishment);
  };

  return {
    forEstablishment,
    async forEstablishmentId(establishmentId) {
      const establishment = await repo.establishments.findById(establishmentId);
      if (!establishment) return null;
      return forEstablishment(establishment);
    },
  };
}
