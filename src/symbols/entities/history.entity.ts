import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  ManyToOne,
} from 'typeorm';
import { Symbol } from './symbol.entity';

@Entity('history')
export class History {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'float', nullable: false })
  price: number;

  @ManyToOne(() => Symbol, (symbol) => symbol.history, { onDelete: 'CASCADE' })
  symbol: Symbol;

  @CreateDateColumn({ name: 'createdAt' })
  createdAt: Date;
}
