import { EntitySchema } from "typeorm";

export const Message = new EntitySchema({
  name: "Message",
  tableName: "messages",
  columns: {
    id: {
      primary: true,
      type: "uuid",
      generated: "uuid"
    },
    content: {
      type: "text"
    },
    sender: {
      type: "uuid"
    },
    receiver: {
      type: "uuid"
    },
    createdAt: {
      type: "timestamp",
      createDate: true
    }
  },
  relations: {
    senderUser: {
      type: "many-to-one",
      target: "User",
      joinColumn: { name: "sender" }
    },
    receiverUser: {
      type: "many-to-one",
      target: "User",
      joinColumn: { name: "receiver" }
    }
  }
});