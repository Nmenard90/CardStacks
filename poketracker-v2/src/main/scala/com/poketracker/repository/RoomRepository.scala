package com.poketracker.repository

import cats.syntax.all.*
import com.poketracker.models.*
import doobie.*
import doobie.implicits.*
import doobie.postgres.implicits.*
import doobie.util.transactor.Transactor
import zio.*
import zio.interop.catz.*
import java.time.Instant

trait RoomRepository:
  def listSpaces(userId: String): Task[List[CollectionSpace]]
  def createSpace(userId: String, name: String, spaceType: String): Task[CollectionSpace]
  def createStorageUnit(userId: String, spaceId: String, name: String, unitType: String,
    preset: String, color: String, shelfCount: Int, positionsPerShelf: Int,
    maxStackHeight: Int, config: String): Task[StorageUnit]
  def placeBox(userId: String, boxId: String, spaceId: String, unitId: String,
    shelfIndex: Int, stackIndex: Int, stackLevel: Int): Task[Unit]
  def placeBinder(userId: String, binderId: String, spaceId: String, unitId: String,
    shelfIndex: Int, shelfPosition: Int): Task[Unit]
  def createDisplayCase(userId: String, spaceId: String, name: String, caseType: String,
    preset: String, frameColor: String, lightColor: String, shelfCount: Int,
    slotsPerShelf: Int, config: String): Task[DisplayCase]
  def setDisplayLights(userId: String, caseId: String, enabled: Boolean): Task[Unit]
  def listLots(userId: String): Task[List[InventoryLot]]
  def allocate(userId: String, lotId: String, drawerId: Option[String],
    binderSlotId: Option[String], displaySlotId: Option[String], quantity: Int,
    protection: Option[String], notes: Option[String]): Task[CardAllocation]
  def removeAllocation(userId: String, allocationId: String): Task[Unit]

object RoomRepository:
  final class Live(xa: Transactor[Task]) extends RoomRepository:
    private type SpaceRow = (String,String,String,String,Boolean,Int,Instant,Instant)
    private type UnitRow = (String,String,String,String,String,String,Int,Int,Int,Int,String,Instant,Instant)
    private type CaseRow = (String,String,String,String,String,String,String,Boolean,Int,Int,Int,String,Instant,Instant)

    def listSpaces(userId: String): Task[List[CollectionSpace]] =
      val spaces = sql"""SELECT id,user_id,name,space_type,is_default,position,created_at,updated_at
        FROM collection_spaces WHERE user_id=$userId ORDER BY position,created_at""".query[SpaceRow].to[List]
      val units = sql"""SELECT su.id,su.space_id,su.name,su.unit_type,su.preset,su.color,su.shelf_count,
        su.positions_per_shelf,su.max_stack_height,su.position,su.config::text,su.created_at,su.updated_at
        FROM storage_units su JOIN collection_spaces s ON s.id=su.space_id
        WHERE s.user_id=$userId ORDER BY su.space_id,su.position,su.created_at""".query[UnitRow].to[List]
      val cases = sql"""SELECT dc.id,dc.space_id,dc.name,dc.case_type,dc.preset,dc.frame_color,dc.light_color,
        dc.light_enabled,dc.shelf_count,dc.slots_per_shelf,dc.position,dc.config::text,dc.created_at,dc.updated_at
        FROM display_cases dc JOIN collection_spaces s ON s.id=dc.space_id
        WHERE s.user_id=$userId ORDER BY dc.space_id,dc.position,dc.created_at""".query[CaseRow].to[List]
      val slots = sql"""SELECT ds.id,ds.display_case_id,ds.shelf_index,ds.slot_index,ds.label
        FROM display_slots ds JOIN display_cases dc ON dc.id=ds.display_case_id
        JOIN collection_spaces s ON s.id=dc.space_id WHERE s.user_id=$userId
        ORDER BY ds.display_case_id,ds.shelf_index,ds.slot_index"""
        .query[(String,String,Int,Int,Option[String])].to[List]
      (for
        sr <- spaces
        ur <- units
        cr <- cases
        sl <- slots
      yield
        val unitsBySpace = ur.map(StorageUnit.apply.tupled).groupBy(_.spaceId)
        val slotsByCase = sl.map(DisplaySlot.apply.tupled).groupBy(_.displayCaseId)
        val casesBySpace = cr.map { case (id,sid,n,t,p,fc,lc,le,sc,sps,pos,cfg,ca,ua) =>
          DisplayCase(id,sid,n,t,p,fc,lc,le,sc,sps,pos,cfg,slotsByCase.getOrElse(id,Nil),ca,ua)
        }.groupBy(_.spaceId)
        sr.map { case (id,uid,n,t,d,pos,ca,ua) =>
          CollectionSpace(id,uid,n,t,d,pos,unitsBySpace.getOrElse(id,Nil),casesBySpace.getOrElse(id,Nil),ca,ua)
        }
      ).transact(xa)

    def createSpace(userId: String, name: String, spaceType: String): Task[CollectionSpace] =
      val id = java.util.UUID.randomUUID().toString
      val now = Instant.now()
      (for
        pos <- sql"SELECT COALESCE(MAX(position)+1,0) FROM collection_spaces WHERE user_id=$userId".query[Int].unique
        _ <- sql"""INSERT INTO collection_spaces(id,user_id,name,space_type,is_default,position,created_at,updated_at)
          VALUES($id,$userId,$name,$spaceType,FALSE,$pos,$now,$now)""".update.run
      yield CollectionSpace(id,userId,name,spaceType,false,pos,Nil,Nil,now,now)).transact(xa)

    def createStorageUnit(userId: String, spaceId: String, name: String, unitType: String,
      preset: String, color: String, shelfCount: Int, positionsPerShelf: Int,
      maxStackHeight: Int, config: String): Task[StorageUnit] =
      val id = java.util.UUID.randomUUID().toString
      val now = Instant.now()
      (for
        owned <- sql"SELECT COUNT(*) FROM collection_spaces WHERE id=$spaceId AND user_id=$userId".query[Int].unique
        _ <- if owned == 1 then ().pure[ConnectionIO] else FC.raiseError(RuntimeException("Space not found"))
        pos <- sql"SELECT COALESCE(MAX(position)+1,0) FROM storage_units WHERE space_id=$spaceId".query[Int].unique
        _ <- sql"""INSERT INTO storage_units(id,space_id,name,unit_type,preset,color,shelf_count,
          positions_per_shelf,max_stack_height,position,config,created_at,updated_at)
          VALUES($id,$spaceId,$name,$unitType,$preset,$color,$shelfCount,$positionsPerShelf,$maxStackHeight,$pos,$config::jsonb,$now,$now)""".update.run
      yield StorageUnit(id,spaceId,name,unitType,preset,color,shelfCount,positionsPerShelf,maxStackHeight,pos,config,now,now)).transact(xa)

    def placeBox(userId: String, boxId: String, spaceId: String, unitId: String,
      shelfIndex: Int, stackIndex: Int, stackLevel: Int): Task[Unit] =
      sql"""UPDATE storage_boxes b SET space_id=$spaceId,storage_unit_id=$unitId,shelf_index=$shelfIndex,
        stack_index=$stackIndex,stack_level=$stackLevel,updated_at=NOW()
        WHERE b.id=$boxId AND b.user_id=$userId
          AND EXISTS(SELECT 1 FROM storage_units su JOIN collection_spaces s ON s.id=su.space_id
            WHERE su.id=$unitId AND su.space_id=$spaceId AND s.user_id=$userId
              AND $shelfIndex < su.shelf_count AND $stackIndex < su.positions_per_shelf
              AND $stackLevel < su.max_stack_height)""".update.run.flatMap { n =>
          if n == 1 then ().pure[ConnectionIO] else FC.raiseError(RuntimeException("Invalid box placement"))
        }.transact(xa)

    def placeBinder(userId: String, binderId: String, spaceId: String, unitId: String,
      shelfIndex: Int, shelfPosition: Int): Task[Unit] =
      sql"""UPDATE binders b SET space_id=$spaceId,storage_unit_id=$unitId,shelf_index=$shelfIndex,
        shelf_position=$shelfPosition,updated_at=NOW() WHERE b.id=$binderId AND b.user_id=$userId
        AND EXISTS(SELECT 1 FROM storage_units su JOIN collection_spaces s ON s.id=su.space_id
          WHERE su.id=$unitId AND su.space_id=$spaceId AND s.user_id=$userId
            AND $shelfIndex < su.shelf_count AND $shelfPosition < su.positions_per_shelf)""".update.run.flatMap { n =>
          if n == 1 then ().pure[ConnectionIO] else FC.raiseError(RuntimeException("Invalid binder placement"))
        }.transact(xa)

    def createDisplayCase(userId: String, spaceId: String, name: String, caseType: String,
      preset: String, frameColor: String, lightColor: String, shelfCount: Int,
      slotsPerShelf: Int, config: String): Task[DisplayCase] =
      val id = java.util.UUID.randomUUID().toString
      val now = Instant.now()
      (for
        owned <- sql"SELECT COUNT(*) FROM collection_spaces WHERE id=$spaceId AND user_id=$userId".query[Int].unique
        _ <- if owned == 1 then ().pure[ConnectionIO] else FC.raiseError(RuntimeException("Space not found"))
        pos <- sql"SELECT COALESCE(MAX(position)+1,0) FROM display_cases WHERE space_id=$spaceId".query[Int].unique
        _ <- sql"""INSERT INTO display_cases(id,space_id,name,case_type,preset,frame_color,light_color,
          shelf_count,slots_per_shelf,position,config,created_at,updated_at)
          VALUES($id,$spaceId,$name,$caseType,$preset,$frameColor,$lightColor,$shelfCount,$slotsPerShelf,$pos,$config::jsonb,$now,$now)""".update.run
        slotRows = (0 until shelfCount).flatMap(s => (0 until slotsPerShelf).map(i =>
          DisplaySlot(java.util.UUID.randomUUID().toString,id,s,i,None))).toList
        _ <- slotRows.traverse_(slot => sql"""INSERT INTO display_slots(id,display_case_id,shelf_index,slot_index)
          VALUES(${slot.id},$id,${slot.shelfIndex},${slot.slotIndex})""".update.run)
      yield DisplayCase(id,spaceId,name,caseType,preset,frameColor,lightColor,true,shelfCount,slotsPerShelf,pos,config,slotRows,now,now)).transact(xa)

    def setDisplayLights(userId: String, caseId: String, enabled: Boolean): Task[Unit] =
      sql"""UPDATE display_cases dc SET light_enabled=$enabled,updated_at=NOW()
        WHERE dc.id=$caseId AND EXISTS(SELECT 1 FROM collection_spaces s WHERE s.id=dc.space_id AND s.user_id=$userId)"""
        .update.run.void.transact(xa)

    def listLots(userId: String): Task[List[InventoryLot]] =
      sql"""SELECT l.id,l.user_id,l.card_id,l.variant_key,l.edition,l.language,l.condition,l.quantity,
        COALESCE(SUM(a.quantity),0),l.created_at,l.updated_at
        FROM inventory_lots l LEFT JOIN card_allocations a ON a.lot_id=l.id
        WHERE l.user_id=$userId GROUP BY l.id ORDER BY l.updated_at DESC"""
        .query[(String,String,String,String,String,String,String,Int,Int,Instant,Instant)]
        .to[List].map(_.map(InventoryLot.apply.tupled)).transact(xa)

    def allocate(userId: String, lotId: String, drawerId: Option[String],
      binderSlotId: Option[String], displaySlotId: Option[String], quantity: Int,
      protection: Option[String], notes: Option[String]): Task[CardAllocation] =
      val id = java.util.UUID.randomUUID().toString
      val now = Instant.now()
      (for
        owner <- sql"SELECT COUNT(*) FROM inventory_lots WHERE id=$lotId AND user_id=$userId".query[Int].unique
        _ <- if owner == 1 then ().pure[ConnectionIO] else FC.raiseError(RuntimeException("Inventory lot not found"))
        _ <- sql"""INSERT INTO card_allocations(id,lot_id,drawer_id,binder_slot_id,display_slot_id,
          quantity,protection,notes,created_at,updated_at)
          VALUES($id,$lotId,$drawerId,$binderSlotId,$displaySlotId,$quantity,$protection,$notes,$now,$now)""".update.run
      yield CardAllocation(id,lotId,drawerId,binderSlotId,displaySlotId,quantity,protection,notes,now,now)).transact(xa)

    def removeAllocation(userId: String, allocationId: String): Task[Unit] =
      sql"""DELETE FROM card_allocations a USING inventory_lots l
        WHERE a.id=$allocationId AND a.lot_id=l.id AND l.user_id=$userId""".update.run.void.transact(xa)

  val layer: ZLayer[Transactor[Task], Nothing, RoomRepository] = ZLayer.fromFunction(new Live(_))
