import {
    type CreationOptional,
    DataTypes,
    type InferAttributes,
    type InferCreationAttributes,
    Model,
    type NonAttribute,
    Sequelize,
} from "@sequelize/core";
import {
    Attribute,
    AutoIncrement,
    BelongsTo,
    BelongsToMany,
    HasMany,
    Index,
    NotNull,
    PrimaryKey,
    Unique,
} from "@sequelize/core/decorators-legacy";

export class QQUser extends Model<
    InferAttributes<QQUser>,
    InferCreationAttributes<QQUser>
> {
    @Attribute(DataTypes.INTEGER)
    @PrimaryKey
    @AutoIncrement
    declare id: CreationOptional<number>;
    @Attribute(DataTypes.STRING)
    @NotNull
    declare qq: string;
    @Attribute(DataTypes.STRING)
    @NotNull
    declare globalName: string;
    @Attribute(DataTypes.STRING)
    declare avatarMXC: string;
    @Attribute(DataTypes.STRING)
    declare avatarSHA256: string;
    @BelongsToMany(() => BridgedRoom, {
        through: () => QQMemberInBridgedRoom,
        inverse: {
            as: "qqMembers",
        },
        foreignKey: "qqUserId",
        otherKey: "roomId",
    })
    declare joinedRooms: NonAttribute<BridgedRoom[]>;
}

export class QQMemberInBridgedRoom extends Model<
    InferAttributes<QQMemberInBridgedRoom>,
    InferCreationAttributes<QQMemberInBridgedRoom>
> {
    declare qqUserId: number;
    declare roomId: number;
    @Attribute(DataTypes.STRING)
    declare groupNick: string;
}

export class MatrixMemberInBridgedRoom extends Model<
    InferAttributes<MatrixMemberInBridgedRoom>,
    InferCreationAttributes<MatrixMemberInBridgedRoom>
> {
    declare matrixUserId: number;
    declare roomId: number;
    @Attribute(DataTypes.STRING)
    declare displayName: string;
}

export class BridgedRoom extends Model<
    InferAttributes<BridgedRoom>,
    InferCreationAttributes<BridgedRoom>
> {
    @Attribute(DataTypes.INTEGER)
    @PrimaryKey
    @AutoIncrement
    declare id: CreationOptional<number>;
    declare qqMembers: NonAttribute<QQUser[]>;
    declare matrixMembers: NonAttribute<MatrixUser[]>;

    @HasMany(() => Message, "roomId")
    declare messages: number;
}

export class MatrixUser extends Model<
    InferAttributes<MatrixUser>,
    InferCreationAttributes<MatrixUser>
> {
    @Attribute(DataTypes.INTEGER)
    @PrimaryKey
    @AutoIncrement
    declare id: CreationOptional<number>;
    @Attribute(DataTypes.STRING)
    declare globalName: string;

    @Attribute(DataTypes.STRING)
    declare avatarMXC: string;
    @Attribute(DataTypes.STRING)
    declare avatarColor: string;

    @BelongsToMany(() => BridgedRoom, {
        through: () => MatrixMemberInBridgedRoom,
        inverse: {
            as: "matrixMembers",
        },
        foreignKey: "matrixUserId",
        otherKey: "roomId",
    })
    declare joinedRooms: NonAttribute<BridgedRoom[]>;
}

export class Message extends Model<
    InferAttributes<Message>,
    InferCreationAttributes<Message>
> {
    @Attribute(DataTypes.INTEGER)
    @PrimaryKey
    @AutoIncrement
    declare id: CreationOptional<number>;

    @Attribute(DataTypes.UUIDV4)
    @Unique
    @NotNull
    declare uuid: string;

    @Attribute(DataTypes.STRING)
    @NotNull
    declare firstName: string;

    @Attribute(DataTypes.STRING)
    declare lastName: string | null;

    @Attribute(DataTypes.INTEGER)
    @NotNull
    declare roomId: number;
    // sender
    @Attribute(DataTypes.STRING)
    declare senderMatrixUserID: number;
    @BelongsTo(() => MatrixUser, "senderMatrixUserID")
    declare senderMatrixUser?: MatrixUser;

    @Attribute(DataTypes.STRING)
    declare senderQQUserID: number;
    @BelongsTo(() => QQUser, "senderQQUserID")
    declare senderQQUser?: QQUser;

    @Attribute(DataTypes.STRING)
    declare qqBrokerJson: string;

    @Attribute(DataTypes.STRING)
    declare matrixBrokerJson: string;
}

export default [
    QQUser,
    QQMemberInBridgedRoom,
    MatrixMemberInBridgedRoom,
    BridgedRoom,
    MatrixUser,
    Message,
];
