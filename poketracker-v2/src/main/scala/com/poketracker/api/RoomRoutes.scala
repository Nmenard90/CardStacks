package com.poketracker.api

import com.poketracker.service.RoomService
import zio.*
import zio.http.*
import zio.json.*

object RoomRoutes:
  private case class CreateSpaceRequest(name:String,spaceType:Option[String])
  private given JsonDecoder[CreateSpaceRequest]=DeriveJsonDecoder.gen
  private case class CreateUnitRequest(spaceId:String,name:String,unitType:String,preset:String,color:String,
    shelfCount:Int,positionsPerShelf:Int,maxStackHeight:Int,config:Option[String])
  private given JsonDecoder[CreateUnitRequest]=DeriveJsonDecoder.gen
  private case class BoxPlacementRequest(spaceId:String,unitId:String,shelfIndex:Int,stackIndex:Int,stackLevel:Int)
  private given JsonDecoder[BoxPlacementRequest]=DeriveJsonDecoder.gen
  private case class BinderPlacementRequest(spaceId:String,unitId:String,shelfIndex:Int,shelfPosition:Int)
  private given JsonDecoder[BinderPlacementRequest]=DeriveJsonDecoder.gen
  private case class CreateCaseRequest(spaceId:String,name:String,caseType:String,preset:String,frameColor:String,
    lightColor:String,shelfCount:Int,slotsPerShelf:Int,config:Option[String])
  private given JsonDecoder[CreateCaseRequest]=DeriveJsonDecoder.gen
  private case class LightsRequest(enabled:Boolean)
  private given JsonDecoder[LightsRequest]=DeriveJsonDecoder.gen
  private case class AllocationRequest(lotId:String,drawerId:Option[String],binderSlotId:Option[String],
    displaySlotId:Option[String],quantity:Int,protection:Option[String],notes:Option[String])
  private given JsonDecoder[AllocationRequest]=DeriveJsonDecoder.gen
  private case class BinderPlaceRequest(lotId:String,quantity:Int,protection:Option[String],notes:Option[String])
  private given JsonDecoder[BinderPlaceRequest]=DeriveJsonDecoder.gen

  private def bodyAs[A:JsonDecoder](req:Request):Task[A]=for
    body<-req.body.asString
    value<-ZIO.fromEither(body.fromJson[A]).mapError(e=>RuntimeException(s"Bad request: $e"))
  yield value
  private def bad(e:Throwable)=Response.badRequest(e.getMessage)

  val routes:Routes[RoomService,Nothing]=Routes(
    Method.GET / "api" / "spaces" / string("userId") -> handler { (userId:String,_:Request) =>
      ZIO.serviceWithZIO[RoomService](_.listSpaces(userId)).map(v=>Response.json(v.toJson)).catchAll(e=>ZIO.succeed(bad(e)))
    },
    Method.POST / "api" / "spaces" / string("userId") -> handler { (userId:String,req:Request) =>
      (for p<-bodyAs[CreateSpaceRequest](req); v<-ZIO.serviceWithZIO[RoomService](_.createSpace(userId,p.name,p.spaceType.getOrElse("custom")))
      yield Response.json(v.toJson).status(Status.Created)).catchAll(e=>ZIO.succeed(bad(e)))
    },
    Method.POST / "api" / "spaces" / string("userId") / "storage-units" -> handler { (userId:String,req:Request) =>
      (for p<-bodyAs[CreateUnitRequest](req); v<-ZIO.serviceWithZIO[RoomService](_.createStorageUnit(userId,p.spaceId,p.name,p.unitType,p.preset,p.color,p.shelfCount,p.positionsPerShelf,p.maxStackHeight,p.config.getOrElse("{}")))
      yield Response.json(v.toJson).status(Status.Created)).catchAll(e=>ZIO.succeed(bad(e)))
    },
    Method.PUT / "api" / "spaces" / string("userId") / "boxes" / string("boxId") / "placement" -> handler { (userId:String,boxId:String,req:Request) =>
      (for p<-bodyAs[BoxPlacementRequest](req); _<-ZIO.serviceWithZIO[RoomService](_.placeBox(userId,boxId,p.spaceId,p.unitId,p.shelfIndex,p.stackIndex,p.stackLevel))
      yield Response.json("""{"ok":true}""")).catchAll(e=>ZIO.succeed(bad(e)))
    },
    Method.PUT / "api" / "spaces" / string("userId") / "binders" / string("binderId") / "placement" -> handler { (userId:String,binderId:String,req:Request) =>
      (for p<-bodyAs[BinderPlacementRequest](req); _<-ZIO.serviceWithZIO[RoomService](_.placeBinder(userId,binderId,p.spaceId,p.unitId,p.shelfIndex,p.shelfPosition))
      yield Response.json("""{"ok":true}""")).catchAll(e=>ZIO.succeed(bad(e)))
    },
    Method.POST / "api" / "spaces" / string("userId") / "display-cases" -> handler { (userId:String,req:Request) =>
      (for p<-bodyAs[CreateCaseRequest](req); v<-ZIO.serviceWithZIO[RoomService](_.createDisplayCase(userId,p.spaceId,p.name,p.caseType,p.preset,p.frameColor,p.lightColor,p.shelfCount,p.slotsPerShelf,p.config.getOrElse("{}")))
      yield Response.json(v.toJson).status(Status.Created)).catchAll(e=>ZIO.succeed(bad(e)))
    },
    Method.PUT / "api" / "spaces" / string("userId") / "display-cases" / string("caseId") / "lights" -> handler { (userId:String,caseId:String,req:Request) =>
      (for p<-bodyAs[LightsRequest](req); _<-ZIO.serviceWithZIO[RoomService](_.setDisplayLights(userId,caseId,p.enabled))
      yield Response.json("""{"ok":true}""")).catchAll(e=>ZIO.succeed(bad(e)))
    },
    Method.GET / "api" / "spaces" / string("userId") / "inventory" -> handler { (userId:String,_:Request) =>
      ZIO.serviceWithZIO[RoomService](_.getInventory(userId)).map(v=>Response.json(v.toJson)).catchAll(e=>ZIO.succeed(bad(e)))
    },
    Method.GET / "api" / "spaces" / string("userId") / "drawers" / string("drawerId") / "allocations" -> handler { (userId:String,drawerId:String,_:Request) =>
      ZIO.serviceWithZIO[RoomService](_.getDrawerAllocations(userId,drawerId)).map(v=>Response.json(v.toJson)).catchAll(e=>ZIO.succeed(bad(e)))
    },
    Method.GET / "api" / "spaces" / string("userId") / "display-cases" / string("caseId") / "allocations" -> handler { (userId:String,caseId:String,_:Request) =>
      ZIO.serviceWithZIO[RoomService](_.getCaseAllocations(userId,caseId)).map(v=>Response.json(v.toJson)).catchAll(e=>ZIO.succeed(bad(e)))
    },
    Method.GET / "api" / "spaces" / string("userId") / "binders" / string("binderId") / "allocations" -> handler { (userId:String,binderId:String,_:Request) =>
      ZIO.serviceWithZIO[RoomService](_.getBinderAllocations(userId,binderId)).map(v=>Response.json(v.toJson)).catchAll(e=>ZIO.succeed(bad(e)))
    },
    Method.POST / "api" / "spaces" / string("userId") / "binders" / string("binderId") / "slots" / int("slotIndex") / "place" -> handler { (userId:String,binderId:String,slotIndex:Int,req:Request) =>
      (for p<-bodyAs[BinderPlaceRequest](req); v<-ZIO.serviceWithZIO[RoomService](_.placeInBinder(userId,binderId,slotIndex,p.lotId,p.quantity,p.protection,p.notes))
      yield Response.json(v.toJson).status(Status.Created)).catchAll(e=>ZIO.succeed(bad(e)))
    },
    Method.POST / "api" / "spaces" / string("userId") / "allocations" -> handler { (userId:String,req:Request) =>
      (for p<-bodyAs[AllocationRequest](req); v<-ZIO.serviceWithZIO[RoomService](_.allocate(userId,p.lotId,p.drawerId,p.binderSlotId,p.displaySlotId,p.quantity,p.protection,p.notes))
      yield Response.json(v.toJson).status(Status.Created)).catchAll(e=>ZIO.succeed(bad(e)))
    },
    Method.DELETE / "api" / "spaces" / string("userId") / "allocations" / string("id") -> handler { (userId:String,id:String,_:Request) =>
      ZIO.serviceWithZIO[RoomService](_.removeAllocation(userId,id)).as(Response.json("""{"ok":true}""")).catchAll(e=>ZIO.succeed(bad(e)))
    }
  )
