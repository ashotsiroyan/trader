import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  OneToMany,
} from 'typeorm';
import { History } from './history.entity';
import { Order } from './order.entity';

@Entity('symbol')
export class Symbol {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', unique: true, nullable: false })
  name: string;

  @Column({ type: 'timestamp', nullable: false })
  listingDate: Date;

  @Column({ type: 'float', nullable: true })
  priceOnStart: number;

  @Column({ type: 'float', nullable: true })
  priceOnMinute: number;

  @Column({ type: 'bool', default: false })
  isListed: boolean;

  @Column({ type: 'bool', default: false })
  isFinished: boolean;

  @OneToMany(() => History, (history) => history.symbol)
  history: History[];

  @OneToMany(() => Order, (order) => order.symbol)
  orders: Order[];

  @CreateDateColumn({ name: 'createdAt' })
  createdAt: Date;
}
