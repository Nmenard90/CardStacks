/**
 * FILE: RipTrackerService.scala
 * PACKAGE: com.poketracker.service
 * LOCATION: src/main/scala/com/poketracker/service/RipTrackerService.scala
 *
 * PURPOSE:
 *   Business logic for the Rip Tracker feature: running rip (box-opening)
 *   sessions and computing the rip-or-hold verdict. Orchestrates
 *   RipTrackerRepository (session/pull storage), CardRepository (real
 *   prices), CollectionService (merges pulls into the user's collection,
 *   respecting the existing merge rule), and RipOrHoldEngine (the pure
 *   math — this file feeds it, never reimplements it).
 *
 * NOT WIRED INTO Main.scala YET — see RipTrackerRepository's header. This
 * whole feature stays off the live app until Migration 004 has actually
 * been run against production.
 *
 * USED BY: (future) RipRoutes, once wired
 * DEPENDS ON: RipTrackerRepository, CardRepository, CollectionRepository,
 *   CollectionService, CardService, RipOrHoldEngine
 */

package com.poketracker.service

import com.poketracker.models.*
import com.poketracker.repository.{RipTrackerRepository, CardRepository, CollectionRepository}
import zio.*
import java.util.UUID

/**
 * CASE CLASS: PullResult
 * PURPOSE: What POST /rip-sessions/:id/pulls returns for one recorded pull —
 *          the pull itself plus the marginal-value flags the UI uses to
 *          nudge trading/selling a dupe instead of just logging it.
 * @param pull          The recorded Pull, with its collectionEntryId set.
 * @param alreadyOwned  Whether the user owned at least one copy of this card
 *                      BEFORE this pull (i.e. this pull is a duplicate).
 * @param setComplete   Whether the user now owns at least one copy of every
 *                      card in this card's set, after this pull.
 */
final case class PullResult(pull: Pull, alreadyOwned: Boolean, setComplete: Boolean)

/**
 * CASE CLASS: SessionRecap
 * PURPOSE: What GET /rip-sessions/:id returns — the session plus every pack
 *          and every pull, for the end-of-rip review screen.
 */
final case class SessionRecap(session: RipSession, packs: List[RipPack], pulls: List[Pull])

/**
 * TRAIT: RipTrackerService
 * PURPOSE: Interface for all Rip Tracker business logic.
 */
trait RipTrackerService:

  /**
   * Starts a rip session for a product, auto-generating its packs from the
   * product's packCount.
   * @param userId     Who's running this rip.
   * @param productId  Which sealed product is being opened.
   * @return           The created session and its generated packs.
   */
  def createSession(userId: String, productId: String): Task[(RipSession, List[RipPack])]

  /**
   * Records one scanned card into a pack: writes the Pull, merges it into
   * the user's collection (existing merge rule — quantities combine only
   * within the same condition), and flags whether it's a duplicate and/or
   * completes the set.
   * @param ripPackId  Which pack this card was pulled from.
   * @param cardId     The card pulled.
   * @param condition  Logged condition, e.g. "NM".
   * @return           The pull plus marginal-value flags.
   */
  def recordPull(ripPackId: String, cardId: String, condition: String): Task[PullResult]

  /** Full recap of a session — packs and pulls — for the review screen. */
  def getRecap(ripSessionId: String): Task[Option[SessionRecap]]

  /**
   * Builds the rip-or-hold verdict for a product: guaranteed floor, per-pack/
   * open EV, Monte Carlo distribution, ceiling check, and (if a user is
   * given) marginal-to-you value. Every price gap is reported, never guessed.
   * @param sealedProductId       The product to evaluate.
   * @param userId                Optional — enables the marginal-value view.
   * @param chaseThreshold        Optional single-card price threshold for
   *                              "P(pulling a chase hit)".
   * @param projectedSealedPrice  Optional labeled forecast — kept separate
   *                              from the real current sealed price.
   * @param trials                Monte Carlo trial count (brief default 10,000).
   * @return                      The structured Verdict, or None if the
   *                              product doesn't exist.
   */
  def getVerdict(
    sealedProductId:      String,
    userId:               Option[String]  = None,
    chaseThreshold:       Option[Double]  = None,
    projectedSealedPrice: Option[Double]  = None,
    trials:               Int             = 10000
  ): Task[Option[Verdict]]

object RipTrackerService:

  final class Live(
    ripRepo:        RipTrackerRepository,
    cardRepo:       CardRepository,
    collectionRepo: CollectionRepository,
    collectionSvc:  CollectionService,
    cardSvc:        CardService
  ) extends RipTrackerService:

    def createSession(userId: String, productId: String): Task[(RipSession, List[RipPack])] =
      for
        product <- ripRepo.findSealedProduct(productId)
                     .someOrFail(RuntimeException(s"Unknown sealed product: $productId"))
        result  <- ripRepo.createSessionWithPacks(
                     UUID.randomUUID().toString, userId, productId, product.packCount
                   )
      yield result

    /**
     * Adds `delta` to the matching condition's quantity, or appends a new
     * ConditionCount if this condition hasn't been logged for this card yet.
     * This IS the merge rule: same card + same condition combines; same
     * card + a different condition stays a separate line.
     */
    private def mergeConditionQty(
      existing:  List[ConditionCount],
      condition: String,
      delta:     Int
    ): List[ConditionCount] =
      val idx = existing.indexWhere(_.condition == condition)
      if idx >= 0 then
        existing.updated(idx, existing(idx).copy(quantity = existing(idx).quantity + delta))
      else
        existing :+ ConditionCount(condition, delta, price = None)

    private def isSetComplete(userId: String, setId: String): Task[Boolean] =
      for
        setCards    <- cardRepo.findCardsBySet(setId)
        userEntries <- collectionRepo.findByUser(userId)
        ownedIds     = userEntries.map(_.cardId).toSet
        setCardIds   = setCards.map(_.id).toSet
      yield setCardIds.nonEmpty && setCardIds.subsetOf(ownedIds)

    def recordPull(ripPackId: String, cardId: String, condition: String): Task[PullResult] =
      for
        // A pack doesn't carry its own userId — look it up via the session
        // it belongs to. rip_packs -> rip_sessions is the only path to it.
        session    <- resolveSessionForPack(ripPackId)
        _          <- cardSvc.ensureCached(List(cardId))
        card       <- cardRepo.findCardById(cardId)
                        .someOrFail(RuntimeException(s"Unknown card: $cardId"))
        existing   <- collectionRepo.findEntry(session.userId, cardId)
        alreadyOwnedBefore = existing.exists(_.conditions.exists(_.quantity > 0))
        merged      = mergeConditionQty(existing.map(_.conditions).getOrElse(Nil), condition, 1)
        selCond     = existing.map(_.selectedCond).getOrElse(condition)
        updated    <- collectionSvc.updateEntry(session.userId, cardId, merged, selCond)
        pullId      = UUID.randomUUID().toString
        pull       <- ripRepo.insertPull(pullId, ripPackId, cardId, condition, updated.map(_.id))
        complete   <- isSetComplete(session.userId, card.setId)
      yield PullResult(pull, alreadyOwnedBefore, complete)

    /**
     * Finds which rip session a pack belongs to. RipTrackerRepository
     * doesn't expose a direct "pack -> session" lookup (packs are always
     * fetched by session elsewhere), so this does one small query rather
     * than adding a repository method only this call site would ever use.
     */
    private def resolveSessionForPack(ripPackId: String): Task[RipSession] =
      for
        sessionId <- ripRepo.findSessionIdForPack(ripPackId)
                       .someOrFail(RuntimeException(s"Unknown rip pack: $ripPackId"))
        session   <- ripRepo.findSession(sessionId)
                       .someOrFail(RuntimeException(s"Pack $ripPackId points at a missing session $sessionId"))
      yield session

    def getRecap(ripSessionId: String): Task[Option[SessionRecap]] =
      ripRepo.findSession(ripSessionId).flatMap {
        case None => ZIO.succeed(None)
        case Some(session) =>
          for
            packs <- ripRepo.findPacksForSession(ripSessionId)
            pulls <- ripRepo.findPullsForSession(ripSessionId)
          yield Some(SessionRecap(session, packs, pulls))
      }

    def getVerdict(
      sealedProductId:      String,
      userId:               Option[String],
      chaseThreshold:       Option[Double],
      projectedSealedPrice: Option[Double],
      trials:               Int
    ): Task[Option[Verdict]] =
      ripRepo.findSealedProduct(sealedProductId).flatMap {
        case None => ZIO.succeed(None)
        case Some(product) =>
          for
            inserts    <- ripRepo.findProductInserts(sealedProductId)
            guarantees <- ripRepo.findProductGuarantees(sealedProductId)
            rates      <- ripRepo.findPullRates(sealedProductId)

            // Only concrete-card guarantees/inserts can be priced without
            // guessing — a rarity-tier guarantee ("at least one Rare Holo")
            // doesn't identify WHICH card you'll get, and averaging across
            // candidates would be exactly the estimate this engine refuses
            // to do. Rarity-tier guarantees stay visible in the DB for a
            // future, more capable pass; they just don't contribute a
            // dollar figure to this one.
            floorItems  = inserts.filter(_.guaranteed).flatMap(i => i.cardId.map(_ -> i.quantity)) ++
                          guarantees.flatMap(g => g.cardId.map(_ -> g.quantity))

            neededIds   = (floorItems.map(_._1) ++ rates.map(_.cardId)).distinct
            cards      <- ZIO.foreach(neededIds)(cardRepo.findCardById)
            // NM price is the real-price basis throughout — matches how the
            // rest of the app treats "the" price for a card.
            prices      = cards.flatten.flatMap(c => c.prices.flatMap(_.nm).map(c.id -> _)).toMap

            floor       = RipOrHoldEngine.guaranteedFloor(floorItems, prices)
            engineRates = rates.map(r => PullRateInput(r.cardId, r.perPackProbability))
            perPack     = RipOrHoldEngine.perPackEv(engineRates, prices)
            openEv      = floor.total + product.packCount * perPack.expectedValue
            ceiling     = RipOrHoldEngine.ceilingCheck(engineRates, prices, product.currentSealedPrice.getOrElse(0.0))
            dist        = RipOrHoldEngine.simulate(
                            engineRates, prices, product.packCount, floor.total,
                            product.currentSealedPrice.getOrElse(0.0), chaseThreshold, trials
                          )

            marginal   <- userId match
                            case None => ZIO.succeed(None)
                            case Some(uid) =>
                              collectionRepo.findByUser(uid).map { entries =>
                                val owned = entries.map(_.cardId).toSet
                                Some(RipOrHoldEngine.marginalValue(
                                  engineRates, prices, owned, floor.total, product.packCount, ownedDiscount = 0.2
                                ))
                              }
          yield Some(Verdict(
            guaranteedFloor      = floor,
            perPackEv            = perPack,
            openExpectedValue    = openEv,
            distribution         = dist,
            ceiling              = ceiling,
            currentSealedPrice   = product.currentSealedPrice.getOrElse(0.0),
            projectedSealedPrice = projectedSealedPrice,
            marginalValue        = marginal
          ))
      }

  val layer: ZLayer[
    RipTrackerRepository & CardRepository & CollectionRepository & CollectionService & CardService,
    Nothing, RipTrackerService
  ] = ZLayer.fromFunction(new Live(_, _, _, _, _))
