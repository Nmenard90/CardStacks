package com.poketracker.service

import com.poketracker.models.*
import com.poketracker.repository.RoomRepository
import zio.*

trait RoomService:
  def listSpaces(userId:String): Task[List[CollectionSpace]]
  def createSpace(userId:String,name:String,spaceType:String): Task[CollectionSpace]
  def createStorageUnit(userId:String,spaceId:String,name:String,unitType:String,preset:String,color:String,
    shelfCount:Int,positionsPerShelf:Int,maxStackHeight:Int,config:String): Task[StorageUnit]
  def placeBox(userId:String,boxId:String,spaceId:String,unitId:String,shelf:Int,stack:Int,level:Int): Task[Unit]
  def placeBinder(userId:String,binderId:String,spaceId:String,unitId:String,shelf:Int,position:Int): Task[Unit]
  def createDisplayCase(userId:String,spaceId:String,name:String,caseType:String,preset:String,frameColor:String,
    lightColor:String,shelfCount:Int,slotsPerShelf:Int,config:String): Task[DisplayCase]
  def setDisplayLights(userId:String,caseId:String,enabled:Boolean): Task[Unit]
  def getInventory(userId:String): Task[List[InventoryLot]]
  def getDrawerAllocations(userId:String,drawerId:String): Task[List[CardAllocation]]
  def getCaseAllocations(userId:String,caseId:String): Task[List[CardAllocation]]
  def getBinderAllocations(userId:String,binderId:String): Task[List[CardAllocation]]
  def allocate(userId:String,lotId:String,drawerId:Option[String],binderSlotId:Option[String],
    displaySlotId:Option[String],quantity:Int,protection:Option[String],notes:Option[String]): Task[CardAllocation]
  def placeInBinder(userId:String,binderId:String,slotIndex:Int,lotId:String,
    quantity:Int,protection:Option[String],notes:Option[String]): Task[CardAllocation]
  def removeAllocation(userId:String,id:String): Task[Unit]

object RoomService:
  private val spaceTypes=Set("collection_room","archive","trade_station","showcase","custom")
  private val unitTypes=Set("shelf","rack","cabinet","closet","custom")
  private val caseTypes=Set("wall_case","lit_cabinet","museum_vitrine","floating_shelf","pedestal","custom")
  private val protections=Set("raw","sleeved","double_sleeved","toploader","magnetic_holder","graded_slab")
  final class Live(repo:RoomRepository) extends RoomService:
    private def nonEmpty(value:String,label:String)=ZIO.fail(IllegalArgumentException(s"$label cannot be empty")).when(value.trim.isEmpty)
    def listSpaces(userId:String)=repo.listSpaces(userId)
    def createSpace(userId:String,name:String,spaceType:String)=
      nonEmpty(name,"Name") *> ZIO.fail(IllegalArgumentException("Invalid space type")).unless(spaceTypes(spaceType)) *>
        repo.createSpace(userId,name.trim,spaceType)
    def createStorageUnit(userId:String,spaceId:String,name:String,unitType:String,preset:String,color:String,
      shelfCount:Int,positionsPerShelf:Int,maxStackHeight:Int,config:String)=
      nonEmpty(name,"Name") *> ZIO.fail(IllegalArgumentException("Invalid storage unit type")).unless(unitTypes(unitType)) *>
      ZIO.fail(IllegalArgumentException("Shelf dimensions must be positive")).when(shelfCount<1||positionsPerShelf<1||maxStackHeight<1) *>
      repo.createStorageUnit(userId,spaceId,name.trim,unitType,preset,color,shelfCount,positionsPerShelf,maxStackHeight,config)
    def placeBox(userId:String,boxId:String,spaceId:String,unitId:String,shelf:Int,stack:Int,level:Int)=
      ZIO.fail(IllegalArgumentException("Placement coordinates cannot be negative")).when(shelf<0||stack<0||level<0) *>
        repo.placeBox(userId,boxId,spaceId,unitId,shelf,stack,level)
    def placeBinder(userId:String,binderId:String,spaceId:String,unitId:String,shelf:Int,position:Int)=
      ZIO.fail(IllegalArgumentException("Placement coordinates cannot be negative")).when(shelf<0||position<0) *>
        repo.placeBinder(userId,binderId,spaceId,unitId,shelf,position)
    def createDisplayCase(userId:String,spaceId:String,name:String,caseType:String,preset:String,frameColor:String,
      lightColor:String,shelfCount:Int,slotsPerShelf:Int,config:String)=
      nonEmpty(name,"Name") *> ZIO.fail(IllegalArgumentException("Invalid display case type")).unless(caseTypes(caseType)) *>
      ZIO.fail(IllegalArgumentException("Display dimensions must be positive")).when(shelfCount<1||slotsPerShelf<1) *>
      repo.createDisplayCase(userId,spaceId,name.trim,caseType,preset,frameColor,lightColor,shelfCount,slotsPerShelf,config)
    def setDisplayLights(userId:String,caseId:String,enabled:Boolean)=repo.setDisplayLights(userId,caseId,enabled)
    def getInventory(userId:String)=repo.listLots(userId)
    def getDrawerAllocations(userId:String,drawerId:String)=repo.listDrawerAllocations(userId,drawerId)
    def getCaseAllocations(userId:String,caseId:String)=repo.listCaseAllocations(userId,caseId)
    def getBinderAllocations(userId:String,binderId:String)=repo.listBinderAllocations(userId,binderId)
    def allocate(userId:String,lotId:String,drawerId:Option[String],binderSlotId:Option[String],displaySlotId:Option[String],
      quantity:Int,protection:Option[String],notes:Option[String])=
      ZIO.fail(IllegalArgumentException("Choose exactly one destination")).unless(List(drawerId,binderSlotId,displaySlotId).count(_.isDefined)==1) *>
      ZIO.fail(IllegalArgumentException("Quantity must be positive")).when(quantity<1) *>
      ZIO.fail(IllegalArgumentException("Binder and display slots hold one copy")).when((binderSlotId.isDefined||displaySlotId.isDefined)&&quantity!=1) *>
      ZIO.fail(IllegalArgumentException("Invalid protection type")).when(protection.exists(p => !protections.contains(p))) *>
      repo.allocate(userId,lotId,drawerId,binderSlotId,displaySlotId,quantity,protection,notes.map(_.trim).filter(_.nonEmpty))
    def placeInBinder(userId:String,binderId:String,slotIndex:Int,lotId:String,
      quantity:Int,protection:Option[String],notes:Option[String])=
      ZIO.fail(IllegalArgumentException("A binder slot holds exactly one copy")).when(quantity!=1) *>
      ZIO.fail(IllegalArgumentException("Slot index cannot be negative")).when(slotIndex<0) *>
      ZIO.fail(IllegalArgumentException("Invalid protection type")).when(protection.exists(p => !protections.contains(p))) *>
      repo.placeInBinderSlot(userId,binderId,slotIndex,lotId,quantity,protection,notes.map(_.trim).filter(_.nonEmpty))
    def removeAllocation(userId:String,id:String)=repo.removeAllocation(userId,id)
  val layer:ZLayer[RoomRepository,Nothing,RoomService]=ZLayer.fromFunction(new Live(_))
