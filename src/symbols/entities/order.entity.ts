import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  ManyToOne,
} from 'typeorm';
import { Side } from '../enums/side.num';
import { Symbol } from './symbol.entity';

@Entity('order')
export class Order {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', unique: true, nullable: false })
  orderId: string;

  @Column({ type: 'varchar' })
  price: string;

  @Column({ type: 'varchar' })
  origQty: string;

  @Column({ type: 'enum', enum: Side })
  side: Side;

  @ManyToOne(() => Symbol, (symbol) => symbol.orders, { onDelete: 'NO ACTION' })
  symbol: Symbol;

  @CreateDateColumn({ name: 'createdAt' })
  createdAt: Date;
}
